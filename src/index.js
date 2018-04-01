const config = require('./config.js');
const SfEm = require('./sf-em.js');
const Moodle = require('./moodle.js');

const formatSession = function(session) {
  return `Session ${session.sessionNumber} (${session.id.substring(0, 8)}) ` +
         `for event "${session.eventCode}" / "${session.title}"`;
};

const findMoodleDetails = function(sessions, moodleIds, errors) {
  const getMoodleId = function(adminNotes) {
    if (typeof adminNotes !== 'string') { return undefined; }
    if (!adminNotes.match(/^moodle_id = .*$/)) { return undefined; }
    return adminNotes.replace('moodle_id = ', '');
  };
  return sessions.map(session => {
    const moodleId = getMoodleId(session.adminNotes);
    if (typeof moodleId === 'undefined') {
      errors.push(`${formatSession(session)} has a malformed Moodle ID.`);
      return {session, moodleId: null, lastRead: null, lastReadEpoch: null};
    } else {
      if (!moodleIds.hasOwnProperty(session.id)) {
        moodleIds[session.id] = {lastQuery: 0};
      }
      const lastReadEpoch = moodleIds[session.id].lastQuery;
      const lastRead = new Date(lastReadEpoch * 1000);
      console.log(
          ` - ${formatSession(session)} ` +
          `(with Moodle ID "${moodleId}"), last read on ${lastRead} (${lastReadEpoch})`);
      return {session, moodleId, lastRead, lastReadEpoch};
    }
  });
};

const getMoodleCompletions = async function(sessionsWithMoodleIdsAndLastRead, errors, moodle) {
  const completions = [];
  for (let index = 0; index < sessionsWithMoodleIdsAndLastRead.length; index++) {
    const obj = sessionsWithMoodleIdsAndLastRead[index];
    if (obj.moodleId === null) {
      continue;
    }
    console.info(` - ${obj.moodleId}, for any changes since ${obj.lastRead}`);
    try {
      const users = await  moodle.getCourseCompletion(obj.moodleId, obj.lastReadEpoch);
      completions.push({sfData: obj, users: users});
      console.info(`   - ${users.length} user(s)`);
    } catch (e) {
      errors.push(`Session ${obj.session.sessionNumber} for event ${obj.session.eventCode} ` +
                  `(${obj.session.title}, Moodle ID ${obj.moodleId}) could not be retrieved from ` +
                  `moodle: ` + e);
    }
  }
  return Promise.resolve(completions);
};

async function mainProgram(errors) {
  const v = {};
  let abort = false;

  try {
    v.cfg = await config.getConfig();

    v.sfEm = new SfEm(v.cfg.sfHost, v.cfg.sfToken, config.fakeSfApiCalls);
    v.moodle = new Moodle(v.cfg.mHost, v.cfg.mToken, config.fakeMoodleApiCalls);

    const moodleIdsFromConfig = await config.getMoodleLastCheckTimes();
    v.moodleIds = (typeof moodleIdsFromConfig === 'undefined') ? {} : moodleIdsFromConfig;
  } catch (e) {
    errors.push('Could not start: ' + e);
    abort = e;
  }
  if (abort !== false) {
    throw abort;
  }

  console.info('Fetching all unprocessed Moodle sessions from SkillsForge...');
  try {
    v.sessions = await v.sfEm.getUnprocessedSessions();
  } catch (e) {
    errors.push(e.toString());
  }

  console.log(`Found ${v.sessions.length} session(s):`);
  const sessionsWithMoodleInfo = findMoodleDetails(v.sessions, v.moodleIds, errors);

  console.info(`Fetching user completion times from Moodle...`);
  try {
    v.completions = await getMoodleCompletions(sessionsWithMoodleInfo, errors, v.moodle);
  } catch (e) {
    errors.push('Could not fetch moodle completion statuses.');
    abort = e;
  }
  if (abort !== false) {
    throw abort;
  }

  v.sessionUsers = {};
  for (let index = 0; index < v.completions.length; index++) {
    const su = v.completions[index];
    if (su.users.length === 0) {
      // Only set last query date when ALL fetches are successful - if there are no users, there is
      // no further need for fetches, and so this is complete.
      v.moodleIds[su.sfData.session.id].lastQuery = Math.floor(Date.now() / 1000);
      continue;
    }
    v.sessionUsers[su.sfData.session.id] = su.users.map(user => user.idnumber.toLowerCase());
  }

  console.log('Submitting new attendance records to SkillsForge...');
  console.debug(v.sessionUsers);
  const numUpdated = await v.sfEm.updateAttendance(v.sessionUsers).catch(reason => {
    console.log('Caught');
    errors.push('Could not submit new attendance records: ' + reason);
    abort = reason;
  });
  if (abort !== false) {
    throw abort;
  }
  console.log(`Updated ${numUpdated} registration(s).`);

  for (const sessionId in v.sessionUsers) {
    if (!v.sessionUsers.hasOwnProperty(sessionId)) {continue;}
    v.moodleIds[sessionId].lastQuery = Math.floor(Date.now() / 1000);
  }
  try {
    await config.putMoodleLastCheckTimes(v.moodleIds);
  } catch (e) {
    errors.push('Could not save last-checked timestamps: ' + e);
  }
}

let errorArray = [];
const mainPromise = mainProgram(errorArray);
mainPromise.catch(e => {
  console.log('Problem: ' + e);
  if (errorArray.length > 0) {
    console.log('Errors to Report:');
    errorArray.forEach(e => console.log(' - ' + e));
  }
});
mainPromise.then(() => {
  if (errorArray.length > 0) {
    console.log('Errors to Report:');
    errorArray.forEach(e => console.log(' - ' + e));
  }
});
const config = require('./config.js');
const SfEm = require('./sf-em.js');
const Moodle = require('./moodle.js');
const postmark = require('postmark');

const epochNow = function() {
  return Math.floor(Date.now() / 1000);
};

const formatSession = function(session) {
  return `Session ${session.sessionNumber} (${session.id.substring(0, 8)}) ` +
         `for event "${session.eventCode}" / "${session.title}"`;
};

const findMoodleDetails = function(sessions, queryHistory, errors) {
  const getMoodleId = function(adminNotes) {
    if (typeof adminNotes !== 'string') { return undefined; }
    if (!adminNotes.match(/^moodle_id = .*$/)) { return undefined; }
    return adminNotes.replace('moodle_id = ', '');
  };

  return sessions.map(session => {
    const moodleId = getMoodleId(session.adminNotes);
    if (typeof moodleId === 'undefined') {
      errors.push(`${formatSession(session)} has a malformed Moodle ID.`);
      console.error(` ! ${formatSession(session)} has a malformed Moodle ID.`);
      return {session, moodleId: null, lastRead: null, lastReadEpoch: null};
    } else {
      if (!queryHistory.hasOwnProperty(session.id)) {
        queryHistory[session.id] = {lastQuery: 0};
      }
      const lastReadEpoch = queryHistory[session.id].lastQuery;
      const lastRead = new Date(lastReadEpoch * 1000);
      const lastReadString = lastReadEpoch === 0 ? 'previously unseen.'
                                                 : `last read on ${lastRead} [${lastReadEpoch}]`;
      console.info(` - ${formatSession(session)} (with Moodle ID "${moodleId}") ` + lastReadString);
      return {session, moodleId, lastRead, lastReadEpoch};
    }
  });
};

const getMoodleCompletions = async function(sessionWithMoodleInfo, errors, moodle) {
  const completions = [];
  for (let index = 0; index < sessionWithMoodleInfo.length; index++) {
    const obj = sessionWithMoodleInfo[index];
    if (obj.moodleId === null) {
      continue;
    }
    console.info(` - ${obj.moodleId}, for any changes since ${obj.lastRead}`);
    try {
      const users = await moodle.getCourseCompletion(obj.moodleId, obj.lastReadEpoch);
      const idNumbers = users.map(user => user.idnumber.toLowerCase().trim());
      console.info(`   - ${users.length} user(s): ${idNumbers}`);
      completions.push({sfData: obj, users: idNumbers});
    } catch (e) {
      errors.push(`${formatSession(obj.session)} (with Moodle ID "${obj.moodleId}") could not be ` +
                  `retrieved from moodle: ` + e);
    }
  }
  return completions;
};

async function mainProgram(errors, emailDetails) {

  // Fetch configuration from storage, and set up helper objects.
  const cfg = await config.getConfig();
  const sfEm = new SfEm(cfg.sfHost, cfg.sfToken, config.fakeSfApiCalls);
  const moodle = new Moodle(cfg.mHost, cfg.mToken, config.fakeMoodleApiCalls);
  const storedQueryHistory = await config.getQueryHistory();
  const queryHistory = (typeof storedQueryHistory === 'undefined') ? {} : storedQueryHistory;
  emailDetails.fromConfig = cfg.email;

  // Locate all sessions in SkillsForge which have unprocessed attendance.
  console.info('Locating all unprocessed Moodle sessions from SkillsForge...');
  const sessions = await sfEm.getUnprocessedSessions();
  console.info(`Found ${sessions.length} session(s):`);

  // Find the moodle ID from within the admin notes, and lookup the last query time for that course.
  const sessionsWithMoodleInfo = findMoodleDetails(sessions, queryHistory, errors);

  // Find all the users which completed each course since the last query.
  console.info(`\nLocating completion events in Moodle...`);
  const completions = await getMoodleCompletions(sessionsWithMoodleInfo, errors, moodle);

  // Calculate which sessions need their registrations updating.
  const sessionUsersMap = {};
  for (let i = 0; i < completions.length; i++) {
    const moodleCourse = completions[i];
    if (moodleCourse.users.length === 0) {
      queryHistory[moodleCourse.sfData.session.id].lastQuery = epochNow();
      continue;
    }
    sessionUsersMap[moodleCourse.sfData.session.id] = moodleCourse.users;
  }

  // If any users have completed courses, then update SkillsForge accordingly.
  if (Object.keys(sessionUsersMap).length > 0) {
    console.log('\nSubmitting new attendance records to SkillsForge...');
    const numUpdated = await sfEm.updateAttendance(sessionUsersMap);
    console.log(` - Updated ${numUpdated} registration(s).`);

    for (const sessionId in sessionUsersMap) {
      if (!sessionUsersMap.hasOwnProperty(sessionId)) {continue;}
      queryHistory[sessionId].lastQuery = epochNow();
    }
  } else {
    console.log('\nNo users have completed any courses since the last check (or all sessions' +
                ' encountered Moodle API errors.)');
  }

  // Store the last check times for each Moodle course.
  await config.putMoodleLastCheckTimes(queryHistory);

  console.info('\nCompleted.\n');
}

let errorArray = [];
let emailDetails = {};
mainProgram(errorArray, emailDetails)
    .catch(e => {
      console.error('Fatal Issue:', e);
    })
    .then(() => {
      if (typeof emailDetails.fromConfig === 'undefined'
          || typeof emailDetails.fromConfig.pmToken === 'undefined') {
        console.error('\n! No email details configured - please add these to the config.');

      } else if (errorArray.length > 0) {

        // Print to the console
        console.log('== Errors to Report ==');
        errorArray.forEach(e => console.log(' - ' + e));

        // Send as an email
        const errorListString = errorArray.reduce((listSoFar, currentValue) => {
          return listSoFar + '\n - ' + currentValue;
        }, 'The following issues were found with the SkillsForge Moodle Integration:').trim();

        const pmClient = new postmark.Client(emailDetails.fromConfig.pmToken);
        pmClient.sendEmail(
            {
              'From': emailDetails.fromConfig.sender,
              'To': emailDetails.fromConfig.recipients.toString(),
              'Subject': 'Problem(s) found by Moodle<->SkillsForge integration',
              'TextBody': errorListString
            },
            function(error, response) {
              if (error) {
                console.error('! Could not deliver email: ' + error);
              } else {
                console.info(' >>> Email delivered');
              }
            });

      }
    })
    .catch(reason => {
      console.error(`! Could not send email: ${reason}`);
    });

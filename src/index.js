const fetch = require('node-fetch');
const storage = require('node-persist');
const readLine = require('readline');

//const mTokDef = '***REMOVED***';

const staging = true;
const sfHostDef = 'warwick.dev.skillsforge.co.uk';
const mHostDef = 'moodle-staging.warwick.ac.uk';
const sfPathA = '/warwick/api/eventManager/unprocessedSessions/Online%20Moodle%20Course';
const sfPathB = '/warwick/api/eventManager/updateAttendance';
const mPath = '/webservice/rest/server.php' +
              '?wstoken=%TOKEN%' +
              '&wsfunction=warwick_timestamp_get_course_completion_status' +
              '&moodlewsresformat=json' +
              '&courseidnumber=%MOODLEID%' +
              '&timestamp=%TIMESTAMP%';

async function getConfig() {
  const configFromStorage = storage.getItemSync('config');
  if (typeof configFromStorage !== 'undefined') {
    return configFromStorage;
  }

  const getAnswer = function(question, defaultAnswer) {
    return new Promise(resolve => {
      rl.question(question, answer => resolve(answer === '' ? defaultAnswer : answer));
    });
  };

  const rl = readLine.createInterface({input: process.stdin, output: process.stdout});
  const sfHost = await getAnswer(`Enter SkillsForge host name [${sfHostDef}]: `, sfHostDef);
  const mHost = await getAnswer(`Enter Moodle host name [${mHostDef}]: `, mHostDef);
  const sfToken = await getAnswer(`Enter SkillsForge API token: `);
  const mToken = await getAnswer(`Enter Moodle API token: `);
  rl.close();

  if (typeof sfToken === 'undefined' || typeof mToken === 'undefined') {
    throw new Error('Required configuration was not provided.');
  }

  const config = {sfHost, mHost, sfToken, mToken};
  storage.setItemSync('config', config);
  return config;
}

function getUnprocessedSessions(sfHost, sfToken) {
  if (staging) {
    return fakeSFQuery();
  }
  return fetch(`https://${sfHost}${sfPathA}`, {method: 'GET', headers: {'X-Auth-Token': sfToken}})
      .then(data => {
        if (data.status !== 200) {
          return Promise.reject(`Problem querying SF API: ${data.statusText}`);
        }
        return data.json();
      })
      .then(json => {
        if (json['success'] !== true) {
          return Promise.reject(`SF API error: ${json.errorMessage}`);
        }
        return json['data'];
      });
}

const getMoodleId = function(adminNotes) {
  if (typeof adminNotes !== 'string') { return undefined; }
  if (!adminNotes.match(/^moodle_id = .*$/)) { return undefined; }
  return adminNotes.replace('moodle_id = ', '');
};

async function mainProgram(errors) {
  /** @type {{sfHost:string, mHost:string, sfToken:string, mToken:string}} */
  const config = await getConfig();
  console.info(`(*) SF Host:\t\t${config.sfHost}\n(*) Moodle Host:\t${config.mHost}\n`);

  const moodleIdsFromConfig = await storage.getItem('moodleIds');
  /** @typedef {{lastQuery:date}} MoodleStorage */
  /** @type {{MoodleStorage}} */
  const moodleIds = (typeof moodleIdsFromConfig === 'undefined') ? {} : moodleIdsFromConfig;

  /** @typedef {{id:string, eventCode:string, title:string, sessionNumber:number, startDate:string,
  *               startEpoch:number,adminNotes:?string}} Session */
  /** @type{Array<Session>} */
  const sessions = await getUnprocessedSessions(config['sfHost'], config['sfToken']);

  console.log(`Processing ${sessions.length} session(s):`);

  /** @typedef {{session:Session, moodleId:?string, lastRead:?date, lastReadEpoch:?number}} SfData */
  /** @type {Array<SfData>} */
  const sessionsWithMoodleIdsAndLastRead = sessions.map(session => {
    const moodleId = getMoodleId(session.adminNotes);
    if (typeof moodleId === 'undefined') {
      errors.push(`Session ${session.sessionNumber} for event ${session.eventCode} ` +
                  `(${session.title}) has a malformed Moodle ID.`);
      return {session, moodleId: null, lastRead: null, lastReadEpoch: null};
    } else {
      if (!moodleIds.hasOwnProperty(session.id)) {
        moodleIds[session.id] = {lastQuery: new Date(0)};
      }
      const lastRead = moodleIds[session.id].lastQuery;
      const lastReadEpoch = (lastRead).getTime();

      console.log(
          ` - Session ${session.sessionNumber} for "${session.eventCode}" ` +
          `(with Moodle ID "${moodleId}") was last read on epoch ${lastRead} (${lastReadEpoch})`);
      return {session, moodleId, lastRead, lastReadEpoch};
    }
  });

  /** @typedef {{userid:number, timecompleted:number, idnumber:string}} MoodleCompletion */
  /** @type {Array<{sfData:SfData, users:?Array<MoodleCompletion>}>} */
  const completions = [];
  for (let index = 0; index < sessionsWithMoodleIdsAndLastRead.length; index++) {
    const obj = sessionsWithMoodleIdsAndLastRead[index];
    if (obj.moodleId === null) {
      continue;
    }

    let users;
    try {
      users = await getMoodleCourseCompletion(config.mHost, config.mToken, obj.moodleId,
                                              obj.lastReadEpoch);
    } catch (e) {
      errors.push(`Session ${obj.session.sessionNumber} for event ${obj.session.eventCode} ` +
                  `(${obj.session.title}, Moodle ID ${obj.moodleId}) could not be located in ` +
                  `moodle: ` + e);
    }
    completions.push({sfData: obj, users: users});
  }

  const sessionUsers = {};
  for (let index = 0; index < completions.length; index++) {
    const /** @type {{sfData:SfData, users:?Array<MoodleCompletion>}} */ su = completions[index];
    if (su.users.length === 0) {
      // Only set last query date when ALL fetches are successful - if there are no users, there is
      // no further need for fetches, and so this is complete.
      moodleIds[su.sfData.session.id].lastQuery = new Date();
      continue;
    }
    sessionUsers[su.sfData.session.id] = su.users.map(user => user.idnumber.toLowerCase());
  }

  console.log('Submitting new attendance records to SkillsForge...');
  console.debug(sessionUsers);
  let data;
  try {
    data = await fetch(`https://${config.sfHost}/${sfPathB}`, {
      headers: {'X-Auth-Token': config.sfToken, 'Content-Type': 'application/json'},
      method: 'POST',
      body: {newAttendanceType: 'ATTENDED', usersOfSessions: sessionUsers}
    });
  } catch (e) {
    errors.push(`Could not submit attendance update: await Fetch failed: ` + e);
    return;
  }

  if (data.status !== 200) {
    errors.push(`Could not submit attendance update: ${data.statusText}`);
    return;
  }
  const json = data.json();
  if (json.success !== true) {
    errors.push(`SkillsForge API Error: ${json.errorMessage}`);
    return;
  }
  console.log(`Updated ${json.data} registration(s).`);
  for (const sessionId in sessionUsers) {
    if (!sessionUsers.hasOwnProperty(sessionId)) {continue;}
    moodleIds[sessionId].lastQuery = new Date();
  }
  await storage.putItem('moodleIds', moodleIds);
}

storage.initSync({dir: 'persistence/'});

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

function fakeSFQuery() {
  return JSON.parse(`[
        {
            "id": "***REMOVED***",
            "eventCode": "***REMOVED***",
            "title": "Researcher Skills Moodle",
            "sessionNumber": 1,
            "startDate": "2017-09-16T20:00",
            "startEpoch": 1505592000000,
            "endDate": "2019-09-16T21:00",
            "endEpoch": 1568667600000,
            "adminNotes": null
        },
        {
            "id": "***REMOVED***",
            "eventCode": "***REMOVED***",
            "title": "test",
            "sessionNumber": 1,
            "startDate": "2018-08-26T08:00",
            "startEpoch": 1535270400000,
            "endDate": "2018-08-26T09:00",
            "endEpoch": 1535274000000,
            "adminNotes": "moodle_id = ***REMOVED***"
        }
    ]`);
}

function fakeMoodleQuery() {
  return JSON.parse(
      `[{"userid":***REMOVED***,"timecompleted":1508501109,"idnumber":"***REMOVED***"},
      {"userid":***REMOVED***,"timecompleted":1512731344,"idnumber":"***REMOVED***"}]`);

}

async function getMoodleCourseCompletion(mHost, mToken, moodleId, lastReadEpoch) {
  if (staging) {
    return fakeMoodleQuery();
  }
  return JSON.parse(`[]`);
}
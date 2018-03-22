const fetch = require('node-fetch');
const storage = require('node-persist');
const readLine = require('readline');

storage.initSync({dir: 'persistence/'});

//const mTokDef = '***REMOVED***';

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

async function mainProgram() {
  const errors = [];
  try {

    const config = await getConfig();
    console.log(`(*) SF Host:\t\t${config.sfHost}\n(*) Moodle Host:\t${config.mHost}\n`);

    const moodleIdsFromConfig = storage.getItemSync('moodleIds');
    const moodleIds = (typeof moodleIdsFromConfig === 'undefined') ? {} : moodleIdsFromConfig;

    /*
        const sessions = await getUnprocessedSessions(config['sfHost'], config['sfToken']);
    */
    const sessions = fakeSFQuery();

    console.log(`Processing ${sessions.length} session(s):`);
    const pmAllSessions = sessions.map(async session => {
      try {
        // Moodle course ID
        const moodleId = getMoodleId(session.adminNotes);
        if (typeof moodleId === 'undefined') {
          errors.push(`Session ${session.sessionNumber} for event ${session.eventCode} ` +
                      `(${session.title}) has a malformed Moodle ID.`);
          return {session: session};
        }

        // Time this program last queried Moodle about this course
        if (!moodleId.hasOwnProperty(moodleId)) {
          moodleIds[moodleId] = {lastQuery: new Date(0)};
        }
        const lastRead = moodleIds[moodleId].lastQuery;
        const lastReadEpoch = (lastRead).getTime();

        console.log(
            ` - Session ${session.sessionNumber} for "${session.eventCode}" ` +
            `(with Moodle ID "${moodleId}") was last read on epoch ${lastRead} (${lastReadEpoch})`);

        /*
                const users = await getMoodleCourseCompletion(config.mHost, config.mToken, moodleId,
                                                              lastReadEpoch);
        */
        const users = fakeMoodleQuery();
        return {session: session, moodleId: moodleId, users: users};
      } catch (e) {
        errors.push(`Session ${session.id} encountered an unexpected problem: ${e}`);
        return {session: session};
      }
    });

    Promise.all(pmAllSessions)
           .then(courses => {
             const sessionUsers = {};

             courses.forEach(course => {
               if (!course.hasOwnProperty('users') || course.users.length === 0) {
                 if (course.hasOwnProperty('moodleId')) {
                   moodleIds[course.moodleId].lastQuery = new Date();
                 }
                 return;
               }

               if (!sessionUsers.hasOwnProperty(course.session.id)) {
                 sessionUsers[course.session.id] = [];
               }
               course.users.forEach(user => {
                 sessionUsers[course.session.id].push(user.idnumber.toLowerCase());
               });
             });

             return sessionUsers;
           })
           .then(sessionUsers => fetch(`https://${config.sfHost}/${sfPathB}`, {
             headers: {'X-Auth-Token': config.sfToken, 'Content-Type': 'application/json'},
             method: 'POST',
             body: {newAttendanceType: 'ATTENDED', usersOfSessions: sessionUsers}
           }))
           .then(data => {
             if (data.status !== 200) {
               return Promise.reject(`Could not submit attendance update: ${data.statusText}`);
             }
             return data.json();
           })
           .then(json => {
             if (json.success !== true) {
               return Promise.reject(`API Error: ${json.errorMessage}`);
             }
             console.log(`Updated ${json.data} registration(s)`);
             return json.data;
           })
           .catch(reason => { throw new Error(reason);});

  } catch (e) {
    console.log('odear: ' + e);
  } finally {
    if (errors.length > 0) {
      console.log('Errors to Report:');
      errors.forEach(e => console.log(' - ' + e));
    }
  }
}

mainProgram()
    .catch(e => {
      console.log('ohno: ' + e);
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
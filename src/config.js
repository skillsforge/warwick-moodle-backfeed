const storage = require('node-persist');
const readLine = require('readline');

exports.fakeMoodleApiCalls = true;
exports.fakeSfApiCalls = true;

//const mTokDef = '***REMOVED***';
const pmSenderDef = 'infrastructure@skillsforge.co.uk';
const sfHostDef = 'warwick.dev.skillsforge.co.uk/warwick';
const mHostDef = 'moodle-staging.warwick.ac.uk';
const mPath = '/webservice/rest/server.php' +
              '?wstoken=%TOKEN%' +
              '&wsfunction=warwick_timestamp_get_course_completion_status' +
              '&moodlewsresformat=json' +
              '&courseidnumber=%MOODLEID%' +
              '&timestamp=%TIMESTAMP%';

/** @typedef {{lastQuery:number}} MoodleStorage */
/** @returns {{MoodleStorage}} */
exports.getMoodleLastCheckTimes = function() {
  return storage.getItem('moodleIds');
};

exports.putMoodleLastCheckTimes = function(moodleIds) {
  return storage.setItem('moodleIds', moodleIds);
};

exports.getConfig = async function() {
  await storage.init({dir: 'persistence/'});

  const configFromStorage = await storage.getItem('config');
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
  const recipientsCsv = await getAnswer(`Enter (comma-separated) list of email recipients: []`);
  const sender = await getAnswer(`Enter Postmark sender address: [${pmSenderDef}]`, pmSenderDef);
  const pmToken = await getAnswer(`Enter Postmark API token: `);
  rl.close();

  const recipients = recipientsCsv.trim() === ''
                     ? []
                     : recipientsCsv.split(',').map(addr => addr.trim());

  const config = {sfHost, mHost, sfToken, mToken, email: {recipients, sender, pmToken}};
  await storage.setItem('config', config);
  return config;
};


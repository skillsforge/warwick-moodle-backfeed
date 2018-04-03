const storage = require('node-persist');
const readLine = require('readline');

exports.fakeMoodleApiCalls = false;
exports.fakeSfApiCalls = false;

const pmSenderDef = 'infrastructure@skillsforge.co.uk';
const sfHostDef = 'warwick.dev.skillsforge.co.uk/warwick';
const mHostDef = 'moodle-staging.warwick.ac.uk';

exports.getQueryHistory = function() {
  return storage.getItem('queryHistory');
};

exports.putMoodleLastCheckTimes = function(queryHistory) {
  return storage.setItem('queryHistory', queryHistory);
};

exports.getConfig = async function() {
  await storage.init({dir: 'persistence/'});

  const configFromStorage = await storage.getItem('config');
  if (typeof configFromStorage !== 'undefined') {
    return configFromStorage;
  }

  // todo: check error throwing works correctly from this point forward
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
  const mFunction = await getAnswer(`Enter Moodle WS Function Name: `);
  const recipientsCsv = await getAnswer(`Enter comma-separated list of email recipients []: `, '');
  const sender = await getAnswer(`Enter Postmark sender address [${pmSenderDef}]: `, pmSenderDef);
  const pmToken = await getAnswer(`Enter Postmark API token: `);
  rl.close();

  const recipients = recipientsCsv.trim() === ''
                     ? []
                     : recipientsCsv.split(',').map(addr => addr.trim());

  const config = {sfHost, mHost, sfToken, mToken, mFunction, email: {recipients, sender, pmToken}};
  await storage.setItem('config', config);
  return config;
};


const fetch = require('node-fetch');

const courseCompletionPath = '/webservice/rest/server.php' +
                             '?wstoken=%TOKEN%' +
                             '&wsfunction=%FUNCTION%' +
                             '&moodlewsrestformat=json' + // Note, "jsonArray" here returns XML!
                             '&courseidnumber=%MOODLEID%' +
                             '&timestamp=%TIMESTAMP%';

module.exports = class Moodle {
  constructor(mHost, mToken, completionFunctionName, useFakeCalls = false) {
    this.host = mHost;
    this.token = mToken;
    this.useFakeCalls = useFakeCalls;
    this.completionFunctionName = completionFunctionName;
  }

  async getCourseCompletion(moodleId, lastReadEpoch) {
    if (this.useFakeCalls) {
      return fakeMoodleQuery();
    }

    const path = courseCompletionPath
        .replace('%TOKEN%', this.token)
        .replace('%MOODLEID%', moodleId)
        .replace('%FUNCTION%', this.completionFunctionName)
        .replace('%TIMESTAMP%', lastReadEpoch);

    const data = await fetch(`https://${this.host}${path}`, {method: 'GET'});
    if (data.status !== 200) {
      throw new Error(`Problem querying Moodle API: ${data.statusText}`);
    }

    let json;
    try {
      json = await data.json();
    } catch (e) {
      throw new Error(`Could not deserialise response from Moodle: ` + e);
    }
    if (json.hasOwnProperty('errorcode')) {
      throw new Error(`Moodle API Exception: ${json.errorcode}: ${json.message}`);
    }
    return json;
  }
};

function fakeMoodleQuery() {
  return JSON.parse(
      `[{"userid":1234,"timecompleted":1508501109,"idnumber":"***REMOVED***"},
      {"userid":5678,"timecompleted":1512731344,"idnumber":"***REMOVED***"}]`);

}

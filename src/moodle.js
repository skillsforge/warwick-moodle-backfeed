const fetch = require('node-fetch');

module.exports = class Moodle {
  constructor(mHost, mToken, useFakeCalls = false) {
    this.host = mHost;
    this.token = mToken;
    this.useFakeCalls = useFakeCalls;
  }

  getCourseCompletion(moodleId, lastReadEpoch) {
    if (this.useFakeCalls) {
      return Promise.resolve(fakeMoodleQuery());
    }
    return fetch(`https://${this.host}${courseCompletionPath}`,
                 {method: 'GET', headers: {}})
        .then(data => {
          if (data.status !== 200) {
            return Promise.reject(`Problem querying Moodle API: ${data.statusText}`);
          }
          return data.json();
        });
  }
};

function fakeMoodleQuery() {
  return JSON.parse(
      `[{"userid":***REMOVED***,"timecompleted":1508501109,"idnumber":"***REMOVED***"},
      {"userid":***REMOVED***,"timecompleted":1512731344,"idnumber":"***REMOVED***"}]`);

}

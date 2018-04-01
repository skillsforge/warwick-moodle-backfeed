const fetch = require('node-fetch');

const unprocessedSessionsPath = '/warwick/api/eventManager/unprocessedSessions/Online%20Moodle%20Course';
const updateAttendancePath = '/warwick/api/eventManager/updateAttendance';

module.exports = class SfEm {
  constructor(sfHost, sfToken, useFakeCalls = false) {
    this.host = sfHost;
    this.token = sfToken;
    this.useFakeCalls = useFakeCalls;
  }

  getUnprocessedSessions() {
    if (this.useFakeCalls) {
      return Promise.resolve(fakeUnprocessedSessionsResult());
    }
    return fetch(`https://${this.host}${unprocessedSessionsPath}`,
                 {method: 'GET', headers: {'X-Auth-Token': this.token}})
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
  };

  updateAttendance(sessionUsersMap) {
    if (this.useFakeCalls) {
      return Promise.resolve(fakeUpdateAttendanceResult());
    }
    return fetch(`https://${this.host}/${updateAttendancePath}`,
                 {
                   headers: {'X-Auth-Token': this.token, 'Content-Type': 'application/json'},
                   method: 'POST',
                   body: {newAttendanceType: 'ATTENDED', usersOfSessions: sessionUsersMap}
                 })
        .then(data => {
          if (data.status !== 200) {
            throw new Error(`Could not submit attendance update: ${data.statusText}`);
          }
          const json = data.json();
          if (json.success !== true) {
            throw new Error(`SkillsForge API Error: ${json.errorMessage}`);
          }
          return json['data'];
        });
  }
};

function fakeUpdateAttendanceResult() {
  return JSON.parse('2');
}

function fakeUnprocessedSessionsResult() {
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

"use strict";
const debug = require("debug")("pioneera-config:loader");
const https = require('https');
const merge = require('deepmerge');

const {
  Storage
} = require('@google-cloud/storage');

const isBase64 = function(data) {
  if (!(data && data.length > 0)) return false;
  const base64 = /^([0-9a-zA-Z+/]{4})*(([0-9a-zA-Z+/]{2}==)|([0-9a-zA-Z+/]{3}=))?$/;
  return base64.test(data);
};

const splitOnce = function(data, search = "_") {
  const components = data.split(search);
  if (components.length > 1) return [components.shift(), components.join(search)];
  return;
};

const download = function(url) {
  return new Promise(function(resolve, reject) {
    const options = {
      protocol: url.protocol,
      host: url.host,
      path: `${url.pathname}${url.search}`,
      json: true,
      headers: {
        "content-type": "application/json",
        "accept": "application/json"
      }
    };

    const req = https.request(options, (res) => {

      if (!(200 <= res.statusCode && res.statusCode <= 299)) {
        console.error('statusCode:', res.statusCode);
        console.error('headers:', res.headers);
        return reject(new Error(`File unavailable (${res.statusCode}) ${url.pathname}`));
      }

      var data = '';
      res.on('data', (d) => {
        data += d;
      });

      res.on('end', function() {
        return resolve(data);
      });

    });

    req.on('error', (e) => {
      return reject(e);
    });
    req.end();

  });
};

const getFromCloudStorage = function(config) {
  return new Promise(function(resolve, reject) {

    const mergeData = function(data) {
      config = merge(data, config);
    };

    const processFile = function(file) {
      return new Promise(function(resolve, reject) {
        const options = {
          action: 'read',
          contentType: 'application/json',
          expires: Date.now() + 15 * 60 * 1000, // 15 minutes
        };

        file.getSignedUrl(options)
          .then(signedUrl => {
            const url = new URL(signedUrl);
            download(url)
              .then(fileData => {
                let data;
                try {
                  data = JSON.parse(fileData);
                } catch (e) {
                  //Nothing
                }
                if (data) mergeData(data);
                return resolve();
              })
              .catch(err => {
                return reject(err);
              });
          })
          .catch(err => {
            return reject(err);
          });
      });
    };

    const projectId = (config.CONFIG.PROJECT_ID) ? config.CONFIG.PROJECT_ID : null;
    const keyFilename = (config.CONFIG.KEY_FILENAME) ? config.CONFIG.KEY_FILENAME : null;
    const storage = new Storage({
      projectId,
      keyFilename
    });
    const configStore = storage.bucket(config.CONFIG.BUCKET_NAME);
    const bucketConfig = {
      versions: true
    };
    configStore.getFiles(bucketConfig)
      .then(files => {
        let filesToProcess = [];
        files.forEach(file => {
          if (file[0].metadata.contentType == "application/json") {
            filesToProcess.push(processFile(file[0]));
          }
        });
        if (filesToProcess.length > 0) {
          Promise.all(filesToProcess)
            .then(() => {
              return resolve(config);
            })
            .catch(err => {
              return reject(err);
            });
        } else {
          return resolve(config);
        }
      })
      .catch(err => {
        return reject(err);
      });
  });
};

module.exports = function(categories = [], config = {}) {
  return new Promise(function(resolve, reject) {

    if (categories && categories.length > 0) {
      Object.keys(process.env).forEach(function(element) {
        const parts = splitOnce(element);
        if (parts && parts[0] && parts[1]) {
          if (categories.includes(parts[0])) {
            const data = process.env[element];
            if (!config.hasOwnProperty(parts[0])) config[parts[0]] = {};
            if (!config[parts[0]].hasOwnProperty(parts[1])) config[parts[0]][parts[1]] = (isBase64(data)) ? Buffer.from(data, 'base64').toString("utf8") : data;
          }
        }
      });
    }

    if (config.hasOwnProperty('CONFIG') && config.CONFIG.hasOwnProperty('BUCKET_NAME')) {
      getFromCloudStorage(config)
        .then(updatedConfig => {
          return resolve(updatedConfig);
        })
        .catch(err => {
          return reject(err);
        });
    } else {
      return resolve(config);
    }
  });
};

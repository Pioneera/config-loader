"use strict";
const debug = require("debug")("pioneera-config:loader");
const merge = require('deepmerge');
const rax = require('retry-axios');
const axios = require('axios');
const uuidv4 = require('uuid/v4');

const {
  Storage
} = require('@google-cloud/storage');

const interceptorId = rax.attach();

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

const download = function(url, nonce) {
  return new Promise(function(resolve, reject) {

    const options = {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        "accept": "application/json",
        "x-goog-pioneera": nonce
      }
    };

    axios(url, options)
      .then(function(res) {
        return resolve(res.data);
      }).catch(function(err) {
        return reject(err);
      });

  });
};

const getFromCloudStorage = function(config) {
  return new Promise(function(resolve, reject) {

    const mergeData = function(data) {
      config = merge(data, config);
    };

    const processFile = function(file) {
      return new Promise(function(resolve, reject) {

        const nonce = uuidv4();

        const options = {
          action: 'read',
          version: 'v2',
          contentType: 'application/json',
          extensionHeaders: {
            "x-goog-pioneera": nonce
          },
          expires: Date.now() + 15 * 60 * 1000, // 15 minutes
        };

        file.getSignedUrl(options)
          .then(signedUrl => {
            if (Array.isArray(signedUrl) && signedUrl.length == 1) signedUrl = signedUrl[0];
            download(signedUrl, nonce)
              .then(fileData => {
                let data = fileData;
                try {
                  data = JSON.parse(fileData);
                } catch (e) {
                  //Nothing
                }
                if (typeof data == "object") mergeData(data);
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
        files.forEach(filelist => {
          filelist.forEach(file => {
            if (file.metadata.contentType == "application/json") {
              filesToProcess.push(processFile(file));
            }
          });
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

/**
 * Stores the configuration to prevent multiple retrieval and generation
 * @type {Object}
 */
let compiledConfig;

/**
 * Retrieves configuration from environment variables and Google Cloud Storage
 * @param  {Array}  [categories=[]] Categories from environment variables
 * @param  {Object} [config={}]     Existing configuration to merge with
 * @return {Promise}                 Returns a promise which will resolve to the config object
 */
module.exports = function(categories = [], config = {}) {
  return new Promise(function(resolve, reject) {
    if(compiledConfig) return resolve(compiledConfig);
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
          compiledConfig = updatedConfig;
          return resolve(compiledConfig);
        })
        .catch(err => {
          return reject(err);
        });
    } else {
      compiledConfig = config;
      return resolve(compiledConfig);
    }
  });
};

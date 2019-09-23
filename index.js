"use strict";
const debug = require("debug")("pioneera-config:loader");
const merge = require('deepmerge');
const rax = require('retry-axios');
const axios = require('axios');
const uuidv4 = require('uuid/v4');

const { Storage } = require('@google-cloud/storage');

const interceptorId = rax.attach();
const encodedBase64 = /^(?:data\:)(?<contentType>\S*\/\S*);base64,(?<encodedData>.*)$/gi;

const convertIfBase64 = function(data) {
  if (!(data && data.length > 0)) return;
  const base64Parts = encodedBase64.exec(data);
  if(!(base64Parts && base64Parts.groups && base64Parts.groups.contentType && base64Parts.groups.encodedData)) return data;
  const decodedData = Buffer.from(base64Parts.groups.encodedData, 'base64');
  if(base64Parts.groups.contentType.toLowerCase().startsWith('text')) return decodedData.toString("utf8");
  return decodedData;
};

const splitOnce = function(data, search = "_") {
  const components = data.split(search);
  if (components.length > 1) return [components.shift(), components.join(search)];
};

const download = function(url, nonce) {
  return new Promise(function(resolve, reject) {

    const options = {
      'headers': {
        'Content-Type': 'application/json',
        'accept': "application/json",
        'x-goog-pioneera': nonce
      },
      'method': 'GET'
    };

    axios(url, options)
      .then(function(res) {
        return resolve(res.data);
      })
      .catch(function(err) {
        return reject(err);
      });

  });
};

const getFromCloudStorage = function(suppliedConfig) {
  return new Promise(function(resolve, reject) {
    debug(`Checking cloud storage.`);

    let config = suppliedConfig;

    const nonce = uuidv4();
    const projectId = (config.config.project_id) ? config.config.project_id : null;
    const keyFilename = (config.config.key_filename) ? config.config.key_filename : null;
    const storage = new Storage({projectId, keyFilename});
    const configStore = storage.bucket(config.config.bucket_name);
    const bucketConfig = { 'versions': true };

    const mergeData = function(data) {
      config = merge(config, data);
    };

    const processFile = function(file) {
      return new Promise(function(resolve, reject) {
        debug(`Retrieving ${file.metadata.bucket}/${file.metadata.name} from Cloud Storage`);

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
            if (Array.isArray(signedUrl) && signedUrl.length === 1) signedUrl = signedUrl[0];
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

    configStore.getFiles(bucketConfig)
      .then(files => {
        let filesToProcess = [];
        files.forEach(filelist => {
          filelist.forEach(file => {
            if (file.metadata.contentType === "application/json") {
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
    if (compiledConfig) return resolve(compiledConfig);
    if (categories && categories.length > 0) {
      Object.keys(process.env).forEach(function(element) {
        const parts = splitOnce(element);
        if (parts && parts[0] && parts[1]) {
          if (categories.includes(parts[0])) {
            const data = process.env[element];
            const category = parts[0].toLowerCase();
            const subCategory = parts[1].toLowerCase();
            if (!config.hasOwnProperty(category)) config[category] = {};
            if (!config[category].hasOwnProperty(subCategory)) config[category][subCategory] = convertIfBase64(data);
          }
        }
      });
    }

    if (config.hasOwnProperty('config') && config.config.hasOwnProperty('bucket_name')) {
      getFromCloudStorage(config)
        .then(updatedConfig => {
          compiledConfig = updatedConfig;
          debug(`Configuration loaded.`);

          return resolve(compiledConfig);
        })
        .catch(err => {
          return reject(err);
        });
    } else {
      compiledConfig = config;
      debug(`Configuration loaded.`);

      return resolve(compiledConfig);
    }
  });
};

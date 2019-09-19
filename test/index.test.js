'use strict';

const assert = require('assert');

const getConfig = require('../');

const config = {
  'CONFIG': {
    'BUCKET_NAME': 'baxter-kms-dev',
    'TEST': "AAA"
  }
};

const configCategories = [
  'TEST',
  'CONFIG'
];

it('should load the config', () => {
  getConfig(configCategories, config)
    .then(updatedConfig => {
      console.log(JSON.stringify(updatedConfig, null, 2));
    })
    .catch(err => {
      console.error(err);
    });
});

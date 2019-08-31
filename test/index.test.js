'use strict';

const assert = require('assert');

const getConfig = require('../');

const config = {
  CONFIG: {
    TEST: "AAA"
  }
};

const configCategories = [
  'TEST'
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
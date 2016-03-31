// external dependencies
var request = require('request');
var builder = require('xmlbuilder');
var xml2js = require('xml2js');

// internal dependencies
var USPSError = require('./error.js');

var usps = module.exports = function(config) {
  if (!(config && config.server && config.userId)) {
    throw 'Error: must pass usps server url and userId';
  }
  if(!config.ttl){
    config.ttl = 100000;
  }

  this.config = config;
};

/**
  Verifies an address

  @param {Object} address The address to be verified
  @param {String} address.street1 Street
  @param {String} [address.street2] Secondary street (apartment, etc)
  @param {String} address.city City
  @param {String} address.state State (two-letter, capitalized)
  @param {String} address.zip Zipcode
  @param {Function} callback The callback function
  @returns {Object} instance of module
*/
usps.prototype.verify = function(address, callback) {
  var obj = {
    Address: {
      Address1: address.street2 || '',
      Address2: address.street1,
      City: address.city,
      State: address.state,
      Zip5: address.zip,
      Zip4: ''
    }
  };

  callUSPS('Verify', 'AddressValidateRequest', 'AddressValidateResponse.Address', this.config, obj, function(err, address) {
    if (err) {
      callback(err);
      return;
    }

    callback(null, {
      street1: address.Address2[0],
      street2: address.Address1 ? address.Address1[0] : '',
      city: address.City[0],
      zip: address.Zip5[0],
      state: address.State[0]
    });
  });

  return this;
};

/**
  Looks up a zipcode, given an address

  @param {Object} address Address to find zipcode for
  @param {String} address.street1 Street
  @param {String} [address.street2] Secondary street (apartment, etc)
  @param {String} address.city City
  @param {String} address.state State (two-letter, capitalized)
  @param {String} address.zip Zipcode
  @param {Function} callback The callback function
  @returns {Object} instance of module
*/
usps.prototype.zipCodeLookup = function(address, callback) {
  var obj = {
    Address: {
      Address1: address.street2 || '',
      Address2: address.street1,
      City: address.city,
      State: address.state
    }
  };

  callUSPS('ZipCodeLookup', 'ZipCodeLookupRequest', 'ZipCodeLookupResponse.Address', this.config, obj, function(err, address) {
    if (err) {
      callback(err);
      return;
    }

    callback(null, {
      street1: address.Address2[0],
      street2: address.Address1 ? address.Address1[0] : '',
      city: address.City[0],
      state: address.State[0],
      zip: address.Zip5[0] + '-' + address.Zip4[0]
    });
  });

  return this;
};

/**
  City State lookup, based on zip

  @param {String} zip Zipcode to retrieve city & state for
  @param {Function} callback The callback function
  @returns {Object} instance of module
*/
usps.prototype.cityStateLookup = function(zip, callback) {
  var obj = {
    ZipCode: {
      Zip5: zip
    }
  };

  callUSPS('CityStateLookup', 'CityStateLookupRequest', 'CityStateLookupResponse.ZipCode', this.config, obj, function(err, address) {
    if (err) {
      callback(err);
      return;
    }

    callback(err, {
      city: address.City[0],
      state: address.State[0],
      zip: address.Zip5[0]
    });
  });
};

/**
  V4 Rate Request

  @param {String} fromZip Zipcode origin
  @param {String} toZip   Zipcode origin
  @param {number} weight  The weight in oz being sent
  @param {String} service The USPS service to use (Defaults as STANDARD POST)
  
  @param {Function} callback The callback function
  @returns {Object} instance of module
*/
usps.prototype.RateV4Request = function(fromZip, toZip, weight, service, callback) {
  // The weight in oz for the request
  var ozWeight = parseInt(weight, 10) || 0,
  
  // The weight in lbs for the request
    lbsWeight = ozWeight / 16;

  // The compiled data for the request
    obj = {
      ID: 0,
      Service: service || "STANDARD POST",
      ZipOrigination: fromZip,
      ZipDestination: toZip,
      Pounds: lbsWeight,
      Ounces: ozWeight,
      Container: '',
      Size: 'REGULAR',
      SpecialServices: {
        SpecialService: 106 // Add tracking
      }
  };

  callUSPS('RateV4', 'RateV4Request', 'RateV4Response', this.config, obj, function(err, data) {
    if (err) {
      callback(err);
      return;
    }

    callback(err, data);
  });
};

/**
  Method to call USPS
*/
function callUSPS(api, method, resultDotNotation, config, params, callback) {
  var obj = {};
  obj[method] = params;
  obj[method]['@USERID'] = config.userId;

  var xml = builder.create(obj).end();

  var opts = {
    url: config.server,
    qs: {
      API: api,
      XML: xml
    },
    timeout: config.ttl,
  };

  request(opts, function(err, res, body) {
    if (err) {
      callback(new USPSError(err.message, err, {
        method: api,
        during: 'request'
      }));
      return;
    }

    xml2js.parseString(body, function(err, result) {
      var errMessage;

      if (err) {
        callback(new USPSError(err.message, err, {
          method: api,
          during: 'xml parse'
        }));
        return;
      }

      // may have a root-level error
      if (result.Error) {
        try {
          errMessage = result.Error.Description[0].trim();
        } catch(err) {
          errMessage = result.Error;
        }

        callback(new USPSError(errMessage, result.Error));
        return;
      }

      /**
        walking the result, to drill into where we want
        resultDotNotation looks like 'key.key'
        though it may actually have arrays, so returning first cell
      */
      var specificResult = result;
      var parts = resultDotNotation.split('.');
      function walkResult() {
        var key = parts.shift();

        if (key === undefined) {
          return;
        }

        specificResult = specificResult[key];

        if (Array.isArray(specificResult)) {
          specificResult = specificResult[0];
        }

        walkResult();
      }
      walkResult();

      // specific error handling
      if (specificResult.Error) {
        try {
          errMessage = specificResult.Error[0].Description[0].trim();
        } catch(err) {
          errMessage = specificResult.Error;
        }

        callback(new USPSError(errMessage, specificResult.Error));
        return;
      }

      // just peachy
      callback(null, specificResult);
    });
  });
}

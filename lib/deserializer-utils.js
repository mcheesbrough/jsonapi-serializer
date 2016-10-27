'use strict';
var P = require('bluebird');
var _ = require('lodash');
var Inflector = require('./inflector');

module.exports = function (jsonapi, data, opts) {
  function isComplexType(obj) {
    return _.isArray(obj) || _.isPlainObject(obj);
  }

  function getValueForRelationship(relationshipData, included) {
    if (opts && relationshipData && opts[relationshipData.type]) {
      var valueForRelationshipFct = opts[relationshipData.type]
        .valueForRelationship;

      return valueForRelationshipFct(relationshipData, included);
    } else {
      return included;
    }
  }

  function findIncluded(relationshipData) {
    return new P(function (resolve) {
      if (!jsonapi.included || !relationshipData) { resolve(null); }

      var included = _.find(jsonapi.included, {
        id: relationshipData.id,
        type: relationshipData.type
      });

      if (included) {
        return P
          .all([extractAttributes(included), extractRelationships(included), extractLinks(included)])
          .spread(function (attributes, relationships, links) {
            resolve(_.extend(attributes, relationships, links));
          });
      } else {
        return resolve(null);
      }
    });
  }

  function keyForAttribute(attribute) {
    if (_.isPlainObject(attribute)) {
      return _.transform(attribute, function (result, value, key) {
        if (isComplexType(value)) {
          result[keyForAttribute(key)] = keyForAttribute(value);
        } else {
          result[keyForAttribute(key)] = value;
        }
      });
    } else if (_.isArray(attribute)) {
      return attribute.map(function (attr) {
        if (isComplexType(attr)) {
          return keyForAttribute(attr);
        } else {
          return attr;
        }
      });
    } else {
      if (_.isFunction(opts.keyForAttribute)) {
        return opts.keyForAttribute(attribute);
      } else {
        return Inflector.caserize(attribute, opts);
      }
    }
  }

  function extractAttributes(from) {
    var dest = keyForAttribute(from.attributes || {});
    if ('id' in from) { dest.id = from.id; }

    return dest;
  }

  function extractLinks(from) {
    if (!(from.links)) { return; }
    var links = keyForAttribute(from.links || {});
    var dest = {};
    if (links) {
      dest.links = links;
    }

    return dest;
  }

  function extractRelationships(from) {
    if (!from.relationships) { return; }

    var dest = {};

    return P
      .each(Object.keys(from.relationships), function (key) {
        var relationship = from.relationships[key];

        if (!relationship.data || relationship.data === null) {
          dest[keyForAttribute(key)] = null;
        } else if (_.isArray(relationship.data)) {
          return P
            .map(relationship.data, function (relationshipData) {
              return extractIncludes(relationshipData);
            })
            .then(function (includes) {
              if (includes) { 
                dest[keyForAttribute(key)] = includes; 
                if (relationship.links) {
                  addLinks(dest[keyForAttribute(key)], relationship.links);
                }
              }
            });
        } else {
          return extractIncludes(relationship.data)
            .then(function (include) {
              if (include) { 
                dest[keyForAttribute(key)] = include; 
                if (relationship.links) {
                  addLinks(dest[keyForAttribute(key)], relationship.links);
                }
              }
            });
        }
        if (relationship.links) {
          dest[keyForAttribute(key)] = {};
          addLinks(dest[keyForAttribute(key)], relationship.links);
        }
      })
      .thenReturn(dest);
  }

  function addLinks(prop, linksToAdd){
    if (prop.links) {
      _.extend(prop.links, linksToAdd);
      
    } else {
      prop.links = linksToAdd;
    }
  }

  function extractIncludes(relationshipData) {
    return findIncluded(relationshipData)
      .then(function (included) {
        var valueForRelationship = getValueForRelationship(relationshipData,
          included);

        if (valueForRelationship && _.isFunction(valueForRelationship.then)) {
          return valueForRelationship.then(function (value) {
            return value;
          });
        } else {
          return valueForRelationship;
        }
      });
  }

  this.perform = function () {
    return P
      .all([extractAttributes(data), extractRelationships(data), extractLinks(data)])
      .spread(function (attributes, relationships, links) {
        return _.extend(attributes, relationships, links);
      });
  };
};

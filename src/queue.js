var uuid = require('uuid')
var debug = require('./debug')('pdf:db')
var error = require('./error')
var webhook = require('./webhook')
var utils = require('./utils')
var queueOptions = {};

function createQueue (db, options = {}) {
  queueOptions = options

  var createQueueMethod = function (func) {
    return function() {
      var args = Array.prototype.slice.call(arguments, 0)
      return func.apply(func, [db].concat(args))
    }
  }

  return {
    addToQueue: createQueueMethod(addToQueue),
    attemptPing: createQueueMethod(attemptPing),
    close: createQueueMethod(close),
    getById: createQueueMethod(getById),
    getList: createQueueMethod(getList),
    getNext: createQueueMethod(getNext),
    getAllUnfinished: createQueueMethod(getAllUnfinished),
    getNextWithoutSuccessfulPing: createQueueMethod(getNextWithoutSuccessfulPing),
    isBusy: createQueueMethod(isBusy),
    processJob: createQueueMethod(processJob),
    purge: createQueueMethod(purge),
    setIsBusy: createQueueMethod(setIsBusy)
  }
}

function addToQueue (db, data) {
  var id = uuid()
  var createdAt = utils.getCurrentDateTimeAsString()

  var defaults = {
    meta: {},
    options: {}
  }

  if (!data.url || !utils.isValidUrl(data.url)) {
    return Promise.resolve(error.createErrorResponse(error.ERROR_INVALID_URL))
  }

  if (data.meta && typeof data.meta !== 'object') {
    return Promise.resolve(error.createErrorResponse(error.ERROR_META_IS_NOT_OBJECT))
  }

  if (data.options && typeof data.options !== 'object') {
    return Promise.resolve(error.createErrorResponse(error.ERROR_OPTIONS_ARE_NOT_OBJECT))
  }
  data.options = _filterKeys(data.options, queueOptions.allowedJobOptions, [])

  data = Object.assign(defaults, data, {
    id: id,
    created_at: createdAt,
    completed_at: null,
    generations: [],
    pings: [],
    storage: {}
  })

  debug('Pushing job to queue with data %s', JSON.stringify(data))

  return db.pushToQueue(data)
    .catch(_dbErrorHandler)
}

function close(db) {
  return db.close()
}

// =========
// RETRIEVAL
// =========

function getList (db, failed = false, completed = false, limit) {
  return db.getList(failed, completed, limit)
    .catch(_dbErrorHandler)
}

function getById (db, id) {
  return db.getById(id)
    .catch(_dbErrorHandler)
}

function getNext (db, shouldWait, maxTries = 5) {
  return getAllUnfinished(db, shouldWait, maxTries).then(function (jobs) {
    return jobs.length > 0 ? jobs[0] : null;
  })
}

function getAllUnfinished (db, shouldWait, maxTries = 5) {
  return db.getAllUnfinished (shouldWait, maxTries)
    .catch(_dbErrorHandler)
}

function getNextWithoutSuccessfulPing (db, shouldWait, maxTries = 5) {
  return db.getNextWithoutSuccessfulPing(shouldWait, maxTries)
    .catch(_dbErrorHandler)
}

// Check if there is a PID lock in the DB, clear stale PID locks
async function isBusy (db) {
  var pid = await db.isBusy()
    .catch(_dbErrorHandler)
  if (pid) {
    // Clear stale lock
    if (!_pidIsAlive(pid)) {
      debug('Clearing stale PID lock ' + pid)
      await setIsBusy(db, false)
      return false
    }
    // Process is still alive and locked
    return true
  }
  return false
}

function purge (db, failed = false, pristine = false, maxTries = 5, age) {
  return db.purge(failed, pristine, maxTries, age)
    .catch(_dbErrorHandler)
}

function setIsBusy(db, isBusy) {
  var pid = (isBusy) ? process.pid : null
  return db.setIsBusy(pid)
    .catch(_dbErrorHandler)
}

// ==========
// PROCESSING
// ==========

function processJob (db, generator, job, webhookOptions) {
  return generator(job.url, job)
    .then(function (response) {
      return _logGeneration(db, job.id, response)
        .then(function (logResponse) {
          if (!error.isError(response)) {
            debug('Job %s was processed, marking job as complete.', job.id)

            return Promise.all([
              _markAsCompleted(db, job.id),
              _setStorage(db, job.id, response.storage)
            ]).then(function () {
              if (!webhookOptions) {
                return response
              }

              // Re-fetch the job as storage has been added
              return getById(db, job.id).then(function (job) {
                // Important to return promise otherwise the npm cli process will exit early
                return attemptPing(db, job, webhookOptions)
                  .then(function() {
                    return response
                  })
              })
            })
          }

          return response
        })
    })
}

// =======
// PINGING
// =======

function attemptPing (db, job, webhookOptions) {
  if (!(typeof webhookOptions === 'object')) {
    throw new Error('No webhook is configured.')
  }

  return webhook.ping(job, webhookOptions)
    .then(response => {
      return _logPing(db, job.id, response)
        .then(function () {
          return response
        })
    })
}

// ===============
// PRIVATE METHODS
// ===============

function _logGeneration (db, id, response) {
  debug('Logging try for job ID %s', id)

  return db.logGeneration(id, response)
    .catch(_dbErrorHandler)
}

function _logPing (db, id, response) {
  debug('Logging ping for job ID %s', id)

  return db.logPing(id, response)
    .catch(_dbErrorHandler)
}

function _markAsCompleted (db, id) {
  var completed_at = utils.getCurrentDateTimeAsString()

  debug('Marking job ID %s as completed at %s', id, completed_at)

  return db.markAsCompleted(id)
    .catch(_dbErrorHandler)
}

function _setStorage (db, id, storage) {
  return db.setStorage(id, storage)
    .catch(_dbErrorHandler)
}

function _filterKeys(unfiltered, whitelist, blacklist) {
    return Object.keys(unfiltered)
        .filter(k => (whitelist.length == 0 || whitelist.includes(k)) && !blacklist.includes(k))
        .reduce((obj, key) => {
            obj[key] = unfiltered[key]
            return obj
        }, {})
}

function _pidIsAlive (pid) {
  try {
    process.kill(pid, 0)
    return true
  }
  catch {
    return false
  }
}

function _dbErrorHandler (e) {
  debug(`DB error: ${e.message}`)
  return Promise.reject()
}

module.exports = createQueue

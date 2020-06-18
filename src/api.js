// these need to occur after dotenv
var express = require('express')
var bodyParser = require('body-parser')
var debug = require('debug')('pdf:api')
var error = require('./error')
var childProcess = require('child_process')

function createApi(createQueue, options = {}) {
  var api = express()
  api.use(bodyParser.json())

  var token = options.token

  if (!token) {
    debug('Warning: The server should be protected using a token.')
  }

  api.post('/', function(req, res) {
    var queue = createQueue()
    var authHeader = req.get('Authorization')

    if (token && (!authHeader || authHeader.replace(/Bearer (.*)$/i, '$1') !== token)) {
      res.status(401).json(error.createErrorResponse(error.ERROR_INVALID_TOKEN))
      return
    }

    queue
      .addToQueue({
        url: req.body.url,
        meta: req.body.meta || {}
      }).then(function (response) {
        queue.close()

        if (error.isError(response)) {
          res.status(422).json(response)
          return
        }

        if (options.postPushCommand && options.postPushCommand.length > 0) {
          childProcess.spawn.apply(null, options.postPushCommand)
        }

        res.status(201).json(response)
      })
  })

  api.get('/job/:jobId/', function(req, res) {
    var queue = createQueue()
    var authHeader = req.get('Authorization')

    if (token && (!authHeader || authHeader.replace(/Bearer (.*)$/i, '$1') !== token)) {
      res.status(401).json(error.createErrorResponse(error.ERROR_INVALID_TOKEN))
      return
    }

    if (!req.params.jobId) {
    }

    queue.getById(req.params.jobId)
      .then(function (job) {
        queue.close()

        if (!job) {
          res.status(404).json(error.createErrorResponse(error.ERROR_INVALID_JOB_ID))
          return
        }
        else {
          res.status(200).json(job)
          return
        }
      })
  })

  return api
}

module.exports = createApi

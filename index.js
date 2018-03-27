"use strict";


//
// lib and utils
//
const util = require('util'),
  setTimeoutPromise = util.promisify(setTimeout),
  fs = require('fs'),
  http = require('http'),
  URL = require('url').URL;


// the mailing service
const mailer = require('./mailer.js')


//
// own variables
//
const APIID = '5378492d8248683e1e16176d90e68731',
  CITYID= '264371',
  weatherUrl = 'http://api.openweathermap.org/data/2.5/weather?id=' + CITYID + '&APPID=' + APIID,
  options = new URL(weatherUrl),
  dataFileBaseName = '.weather.json',
  lastDataFile = 'last' + dataFileBaseName,
  start = Date.now(),
  toDoTasks = {
    getYesterdaysWeather: function(){
      return isDone('getYesterdaysWeather')
    },
    getTodaysWeather: function(){
      return isDone('getTodaysWeather')
    },
    persistWeather: function(){
      return isDone('persistWeather')
    },
    compareWeather: function(){
      return isDone('compareWeather')
    },
    sendWeatherDiff: function(){
      return isDone('sendWeatherDiff')
    },
    updateLastWeatherLink: function(){
      return isDone('updateLastWeatherLink')
    },
  },
  doneTasks = [],
  failedTasks = [],
  activeQs = [],
  millimit = 12000,
  llogQueue = [],
  libroot = process.cwd(),
  dataDir = libroot + '/data/',
  globalTimeOut = 3000;

let startLogging = false;


//
// util functions
//
function isDone(taskName){
  return doneTasks.filter(function(t){
    return Object.keys(t)[0] === taskName
  }) === 1;
}

function getWeatherData(){

  return doneTasks.reduce(function(bucket, t){
      if(Object.keys(t)[0] === 'getTodaysWeather'){
        bucket.push(t['getTodaysWeather'])
      }
      return bucket
    }, [])[0] || {};

}

function addDataDir(fileName){
  return dataDir + fileName
}

function extractWeatherDiff(weatherPair){

  const flatPair = weatherPair.reduce(function(bucket, wp){
    bucket[Object.keys(wp)[0]] = wp[Object.keys(wp)[0]]
    return bucket
  }, {})

  const oldWeather = flatPair['getYesterdaysWeather']
  const newWeather = flatPair['getTodaysWeather']

  //llog(oldWeather, newWeather)

  const oldDt = getDateTime(oldWeather),
    newDt = getDateTime(newWeather),
    oldTemp = getTemperature(oldWeather),
    newTemp = getTemperature(newWeather)

  return {
    oldWeather:{
      dt: oldDt,
      temp: oldTemp
    },
    newWeather: {
      dt: newDt,
      temp: newTemp
    },
    weatherDiff:{
      dt: newDt - oldDt,
      temp: newTemp - oldTemp
    }
  }

}

function llog(toLog){

  const logOut = llogQueue.splice( 0, llogQueue.length )

  if (startLogging && !logOut){
    return console.log(toLog)
  }

  logOut.push(toLog)

  return logOut.forEach(function(l){
    console.log(l)
  })

}


//
// filesystem read/write
//
function readFromFile(lastFileName, fn, cb){

  const fname = fn.name;

  return fs.readFile(lastFileName, function(err, data){

    if (err){
      const sheduled = failedTasks.filter(function(ft){return ft.name === fname }).length === 1;
      !sheduled && failedTasks.push([fn]);
      llog(fname, 'error is ', err);
      return err
      //throw err
    }

    if(!err){
      cb(data)
    }

  })

}

function writeToFile(filename, filecontent, fn){

  const data = Object(filecontent);
  const fname = fn.name;
  return fs.writeFile(filename, JSON.stringify(data), function(err){

    if (err){
      const sheduled = failedTasks.filter(function(ft){return ft.name === fname }).length === 1
      !sheduled && failedTasks.push([fn, data])

      llog(fname, ' error is ', err)
      return err
      //throw err
    }

    if(!err){
      const task = {};
      task[fname] = {
        filecontent: filecontent,
        filename: filename
      }
      return doneTasks.push(task)
    }

  })

}


//
// filesystem unlinking/linking
//
function unlinkLast(fn, unlinkHandler){
  return fs.unlink(addDataDir(lastDataFile), function(err, data){
    if(err){
      return failedTasks.push([fn])
    }
    return unlinkHandler({err: err, data: data})
  })
}

function linkLast(newWeatherFile, fn, linkHandler ){
  const fname = fn.name;
  const linkFile = addDataDir(lastDataFile);

  return fs.symlink(newWeatherFile, linkFile, function(err, data){
    if(err){
      return failedTasks.push([fn])
    }
    return linkHandler({err: err, data: data})
  });
}


//
// http request handlers
//
function httpResponseHandler(res){

  const data = [];

  res.on('data', function(chunk){
    data.push(chunk)
  });

  res.on('end', function(){

    const res = data.reduce(function(bucket, buf){
      return bucket.concat(buf.toString())
    }, '');

    const weatherPayload = JSON.parse(res.toString());

    doneTasks.push({getTodaysWeather: weatherPayload})

  });
}

function httpErrorHandler(err){
  llog('problem with request: ' + err.message);
};


//
// mailing functions
//
const JWT_HEADER = {
   "alg":"RS256",
   "typ":"JWT"
 };

function joinBearer(bearer){
  return "Bearer " + bearer
}

function getIatExpPair(){
  // this is for clock skew
  const xIAT = new Date(Date.now()),
  xEXP = new Date(xIAT.getTime() + (9*60*1000)); // we add nine minutes

  return {
    IAT: (xIAT.getTime()/1000 - 120), // we take out 3 minutes
    EXP: (xEXP.getTime()/1000 )
  }

}

function getJwtDwdClaim(iatExpPair){

  const JWT_DWD_CLAIM = {
    "iss":"sysaaa@weather-ping.iam.gserviceaccount.com",
    "sub":"alex@systemics.gr",
    "scope":"https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.compose",
    "aud":"https://www.googleapis.com/oauth2/v4/token",
    "exp":iatExpPair.EXP,
    "iat":iatExpPair.IAT
  }

  return JWT_DWD_CLAIM
}


//
// these are the loop tools
//
function stopRunning(){

  return Date.now().valueOf() - start.valueOf() > millimit

}

function reRun(fn, options){

  if (typeof fn !== 'function' || (typeof fn === 'object' && fn.length > 1)){
    llog('reRun fn is not usable... returning ');
    return
  }

  failedTasks.push(fn);

  const toReRun = new Set(failedTasks.splice(0, failedTasks.length -1 ));
  toReRun.add(fn);
  backToTheFuture(toReRun)

}

function statusCheck(options){

  const fn = statusCheck;
  llog('checking status... tasks done ' + doneTasks.length.toString() + ' ..to do ' +  Object.entries(toDoTasks).length.toString());

  if (doneTasks.length < Object.entries(toDoTasks).length && !stopRunning()){

    return reRun(fn, options)

  } else {

    activeQs.forEach(function(aq, index){

      aq.then(function(data){
          if (index === activeQs.length - 1){
            llog('thats all folks! Here is the data');
            llog(doneTasks);
            llog('job done!\n')
          }
        },
        function(err){
          llog('statusCheck failed promise .. ', data)
        },
        function(data){
          llog('statusCheck finally .. ', data)
        })

      });

    return 0x0

  }

}

function backToTheFuture(stack){

  return stack.forEach(function(ft){

    const seeYouLater =  setTimeoutPromise(globalTimeOut, ft.name)
      .then(function(options){

        if (typeof ft === 'function'){
          //llog('on reRun setTimeoutPromise failed task is a function .. ');
          return ft(options)
        }

        if (typeof ft === 'object' && ft.length > 1){
          //llog('on reRun setTimeoutPromise failed task is an array ');
          return ft[0](ft[1])
        }

        return ft.length ===1 ? ft[0]() : 0x0

      },
      function(err){
        llog('reRun promise error.. ', err)
      },
      function(final){
        llog('reRun promise finally .. ', final)
      });

    activeQs.push(seeYouLater)

  })

}


//
// business functions
//
function getDateTime(payload){
  return payload.dt
}

function getTemperature(payload){
  return payload.main.temp
}

function getYesterdaysWeather(){
  llog('on getYesterdaysWeather')

  const fn = getYesterdaysWeather;
  const fname = fn.name
  const lastFileName = dataDir + lastDataFile

  readFromFile(lastFileName, fn, function(data){
    const task = {};
    task[fname] = JSON.parse(data.toString())
    return doneTasks.push(task)
  })

}

function getTodaysWeather(){
  llog('on getTodaysWeather')

  const req = http.request(options, httpResponseHandler);

  req.on('error', httpErrorHandler);

  req.end();

}

function persistWeather(data){
  llog('on persistWeather')

  const fn = persistWeather;
  const fname = fn.name;

  const weather = typeof data === 'function' ? data(): null
  const nextFileName = dataDir + Date.now().valueOf() + dataFileBaseName

  if (!weather['dt']){
    return failedTasks.push([fn, data])
  }

  return writeToFile(nextFileName, weather, fn)

}

function compareWeather(){
  llog('on compareWeather')

  const fn = compareWeather;
  const fname = fn.name;

  // check if both new and old weather are present at the done tasks
  // if not reschedule to run
  const requiredTasksKeys = ['getTodaysWeather', 'getYesterdaysWeather'];
  const goodToGo = doneTasks.reduce(function(bucket, t){
      if(Object.keys(t)[0] === requiredTasksKeys[0] || Object.keys(t)[0] === requiredTasksKeys[1]){
        const key = Object.keys(t)[0]
        const wp ={}
        wp[key] = t[key]
        bucket.push(wp)
      }
      return bucket
    }, []);

  if (!goodToGo || !goodToGo.length || goodToGo.length < 2){
    return failedTasks.push([fn])
  }else{
    const task = {};
    task[fname] = extractWeatherDiff(goodToGo)
    return doneTasks.push(task)
  }

}

function sendWeatherDiff(){
  llog('on sendWeather')

  const fn = sendWeatherDiff;
  const fname = fn.name;

  // check if compareWeather task is done
  // if not reschedule to run
  const requiredTasksKeys = ['compareWeather'];

  const goodToGo = doneTasks.reduce(function(bucket, t){
      if(Object.keys(t)[0] === requiredTasksKeys[0] || Object.keys(t)[0] === requiredTasksKeys[1]){
        const key = Object.keys(t)[0]
        const wp ={}
        wp[key] = t[key]
        bucket.push(wp)
      }
      return bucket
    }, []);

  if (!goodToGo || !goodToGo.length || goodToGo.length < 1){
    return failedTasks.push([fn])
  }else{
    const mailBody = mailer.getMsg(JSON.stringify(goodToGo[0]));
    const mailBodyEncoded = mailer.getMsgEncoded(mailBody);

    mailer.gsSend(mailBodyEncoded, function(data){
      const task = {};
      task[fname] = data
      return doneTasks.push(task)
    })

  }
}

function updateLastWeatherLink(){
  llog('on updateLastWeatherLink')

  const fn = updateLastWeatherLink;
  const fname = fn.name;

  // check if new file has been persisted and jos is at the done tasks
  // if not reschedule to run

  const requiredTasksKeys = ['persistWeather'];
  const goodToGo = doneTasks.reduce(function(bucket, t){
      if(Object.keys(t)[0] === requiredTasksKeys[0]){
        const key = Object.keys(t)[0]
        const wp ={}
        wp[key] = t[key]
        bucket.push(wp)
      }
      return bucket
    }, []);

  if (!goodToGo || !goodToGo.length || goodToGo.length < 1){
    return failedTasks.push([fn])
  }else{

    const nextLastFile = goodToGo[0].persistWeather.filename;
    return unlinkLast(fn, function(res){
      if(res.err){
        return failedTasks.push([fn])
      }

      linkLast(nextLastFile, fn, function(res){
        if(res.err){
          return failedTasks.push([fn])
        }
        if(!toDoTasks.updateLastWeatherLink()){
          const task = {};
          task[fname] = {
            nextLastFile: nextLastFile
          }
          doneTasks.push(task)
        }
      })
    })
  }
}


//
// run them all
//
getYesterdaysWeather()
getTodaysWeather()
persistWeather(getWeatherData)
compareWeather()
//sendWeatherDiff()
updateLastWeatherLink()

statusCheck()


// log end of pass zero
startLogging = true

// done

"use strict";


//
// lib and utils
//
const util = require("util"),
  fs = require("fs"),
  http = require("http"),
  https = require("https"),
  URL = require("url").URL,
  crypto = require("crypto"),
  path   = require("path");

//
// g suite settings
//
const GSSCOPE = "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.compose";

//
// openweathermap settings
//
const WEATHER_BASE_URL = "http://api.openweathermap.org/data/2.5/weather?";

//
// own variables
//
const start = Date.now(),
  millimit = 12000,
  globalTimeOut = 33,

  doneTasks = [],
  failedTasks = [],
  timeoutHits = [],
  llogQueue = [],

  dataDir = process.cwd() + "/data/",
  dataFileBaseName = ".weather.json",
  nextLast = dataDir + Date.now().valueOf() + dataFileBaseName,
  lastDataFile = dataDir + "last" + dataFileBaseName,

  toDoTasks = {
    getYesterdaysWeather: {
      isDone: function(){
        return isDone("getYesterdaysWeather")
      },
      fn: getYesterdaysWeather,
      requires: []
    },
    getTodaysWeather: {
      isDone: function(){
        return isDone("getTodaysWeather")
      },
      fn: getTodaysWeather,
      requires: []
    },
    persistWeather: {
      isDone: function(){
        return isDone("persistWeather")
      },
      fn: persistWeather,
      requires: [
        "getTodaysWeather"
      ]
    },
    compareWeather: {
      isDone: function(){
        return isDone("compareWeather")
      },
      fn: compareWeather,
      requires:[
        "getYesterdaysWeather",
        "getTodaysWeather"
      ]
    },
    doMail: {
      isDone: function(){
        return isDone("doMail")
      },
      fn: doMail,
      requires:[
        "compareWeather"
      ]
    },
    unlinkLast: {
      isDone: function(){
        return isDone("unlinkLast")
      },
      fn: unlinkLast,
      requires: []
    },
    linkLast: {
      isDone: function(){
        return isDone("linkLast")
      },
      fn: linkLast,
      requires: [
        "persistWeather"
      ]
    }
  };

const option = {
  nextLast: nextLast,
  dataDir: dataDir,
  lastDataFile: lastDataFile,
  subscribers: ["xelinorg@gmail.com"],
  GSSCOPE: GSSCOPE,
  WEATHER_BASE_URL: WEATHER_BASE_URL,
  link: {
    nextLast: nextLast,
    last: lastDataFile
  }
};

let statusCheckStarted = false,
  startLogging = false;


//
// util functions
//
function noop(){return arguments}

function Base64EncodeUrl(str){
    return str.replace(/\+/g, "-").replace(/\//g, "_").replace(/\=+$/, "")
}

function Base64DecodeUrl(str){
    str = (str + "===").slice(0, str.length + (str.length % 4));
    return str.replace(/-/g, "+").replace(/_/g, "/")
}

function getKeyFromIdentityMap(idenityMap){
  return JSON.parse(idenityMap.toString()).private_key
}

function getClientEmailFromIdentityMap(idenityMap){
  return JSON.parse(idenityMap.toString()).client_email
}

function getSubscribers(subscribers){
  return subscribers.reduce(function(bucket, bcc){
    bucket = bucket + ", <" + bcc + ">"
    return bucket
  }, "")
}

function isDone(taskName){
  return doneTasks.filter(function(t){
    return getKey(t) === taskName
  }) === 1;
}

function getKey(container){
  return Object.keys(container)[0]
}

function taskStatus(fn, option){
  const fname = fn.name;

  const requiredTasksKeys = toDoTasks[fname].requires;
  if (requiredTasksKeys.length < 1){
    return true
  }

  const goodToGo = doneTasks.reduce(function(bucket, t){
    const taskKey = getKey(t);
    const isDone = requiredTasksKeys.indexOf(taskKey) > -1;
      if(isDone){
        const wp ={};
        wp[taskKey] = t[taskKey];
        bucket.push(wp)
      }
      return bucket
    }, []);

  if (!goodToGo || !goodToGo.length || goodToGo.length < requiredTasksKeys.length){
    failedTasks.push([fn, option]);
    return
  }

  return goodToGo

}

function nonBlocking(remaining){

  const doneTasksNames = doneTasks.reduce(function(bucket, dt){
    bucket.push(getKey(dt))
    return bucket
  }, [])

  const doneLength  = remaining[1].requires.filter(function(item){
    return doneTasksNames.indexOf(item) > -1
  }).length

  const requiredLength = remaining[1].requires.length

  return doneLength === requiredLength

}

function notRunning(remaining){
  const activeFound = timeoutHits.filter(function(item){
    return item[0] === remaining[0]
  })
  return activeFound.length < 1
}

function hasRequirements(remaining){
  return remaining[1].requires.length > 0
}

function addDataDir(fileName){
  return dataDir + fileName
}

function getWeatherData(goodToGo){

  if (!goodToGo || !goodToGo.length || !goodToGo.length > 0){
    return {}
  }

  return goodToGo[0]["getTodaysWeather"]

}

function extractWeatherDiff(weatherPair){

  const flatPair = weatherPair.reduce(function(bucket, wp){
    const wpKey = getKey(wp);
    bucket[wpKey] = wp[wpKey]
    return bucket
  }, {})

  const oldWeather = flatPair["getYesterdaysWeather"]
  const newWeather = flatPair["getTodaysWeather"]

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

function getDateTime(payload){
  return payload.dt
}

function getTemperature(payload){
  return payload.main.temp
}

function getPersistOption(option, data){

  let persistData = null;

  if (hasTodaysWeather(data)){
    persistData =  data.filter(function(task){
      if (Object.keys(task)[0] === "getTodaysWeather"){
        return true
      }
      return false
    })
  }

  if (hasDataP(data)){
    persistData = data[1].dataP
  }

  const persistOption = {
    nextLast: option.link.nextLast,
    data: persistData
  }

  return persistOption

}

function hasDataP(data){
  if (data[1] && data[1].dataP){
    return true
  }
  return false
}

function hasTodaysWeather(data){

  const getTodaysWeather = data.filter(function(entry){
    if (entry.getTodaysWeather){
      return true
    }
    return false
  });

  if (getTodaysWeather.length > 0){
    return true
  }

  return false
}

function llog(){

  const logOut = llogQueue.splice( 0, llogQueue.length )

  if (startLogging && !logOut){
    return Array.from(arguments).forEach(function(arg){
      console.log(arg)
    })
  }

  Array.from(arguments).forEach(function(arg){
    logOut.push(arg)
  })

  return logOut.forEach(function(l){
    console.log(l)
  })

}


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

function getJwtDwdClaim(iatExpPair, impersonate, serviceaccount, gsscope){

  const JWT_DWD_CLAIM = {
    "iss": serviceaccount,
    "sub": impersonate,
    "scope": gsscope,
    "aud": "https://www.googleapis.com/oauth2/v4/token",
    "exp": iatExpPair.EXP,
    "iat": iatExpPair.IAT
  }

  return JWT_DWD_CLAIM
}

function signJWT(identitypath, impersonate, gsscope, cb) {

    fs.readFile(identitypath, function(err, data){

      if (err){
        throw err
      }

      const sign = crypto.createSign("RSA-SHA256");

      const iatExpPair = getIatExpPair(),
        jwtBasePair = {
          header: JWT_HEADER,
          body: getJwtDwdClaim(iatExpPair, impersonate, getClientEmailFromIdentityMap(data), gsscope)
        },
        jwtBasePairEncoded = {};

      Array.from(Object.entries(jwtBasePair)).reduce(function(bucket, item){
        bucket[item[0]] = Buffer.from(JSON.stringify(item[1])).toString("base64");
        return bucket
      }, jwtBasePairEncoded);

      const jwtBaseEncoded = jwtBasePairEncoded.header + "." + jwtBasePairEncoded.body;
      sign.update(jwtBaseEncoded);

      return cb(sign.sign(getKeyFromIdentityMap(data), "base64"), jwtBaseEncoded)

    })
}

function encodeJWT(identitypath, impersonate, gsscope, cb){

  return signJWT(identitypath, impersonate, gsscope, function(jwtBaseSigned, jwtBaseEncoded){
    const jwtSignedBase64EncodeUrl = Base64EncodeUrl(jwtBaseSigned.toString());
    const jwtFull = jwtBaseEncoded + "." + jwtSignedBase64EncodeUrl;
    cb(null, jwtFull)
  })

}

function getBearer(jwtFull, cb){

 const postData = "grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=" + jwtFull;

 const options = {
   hostname: "www.googleapis.com",
   path: "/oauth2/v4/token",
   method: "POST",
   headers: {
     "Content-Type": "application/x-www-form-urlencoded",
     "Content-Length": Buffer.byteLength(postData)
   }
 };

 const req = https.request(options, function(res){

    res.setEncoding("utf8");
    const data = [];

    res.on("data", (chunk) => {
      data.push(chunk)
    });

    res.on("end", function() {

      const res = data.reduce(function(bucket, buf){
        return bucket.concat(buf.toString())
      }, "");

      cb(null, res)

    })

  });

 req.on("error", function(e){
    cb(e)
  });

 req.write(postData);
 req.end();

}

function getMsg(impersonate, subscribers, body, ts){

  const msgts = ts || (new Date(Date.now())).toUTCString()

  const msg = "To: <" + impersonate + ">" + "\n" +
    "From: <" + impersonate + ">" + "\n" +
    "Bcc: " + getSubscribers(subscribers) + "\n" +
    "Subject: weather-ping" + "\n" +
    "Date: " + msgts + "\n" +
    "Content-Type: text/plain; charset=\"UTF-8\"" + "\n\n" +

    "This is the weather ping. And the diff is..." + "\n\n" +

    body + "\n\n" +

    "Bye Bye for now!" + "\n";

  return msg

}

function getMsgEncoded(impersonate, subscribers, body, ts){

  const tmpmsg = getMsg(impersonate, subscribers, body, ts);
  const bufferedToBase64 = Buffer.from(tmpmsg).toString("base64");

  return Base64EncodeUrl(bufferedToBase64)

}

function sendMail(option, cb) {

  const postData = {
    raw: getMsgEncoded(option.IAM_MAIL_IMPERSONATE, option.subscribers, option.body)
  },
  dataSerialized = JSON.stringify(postData);

  const options = {
    hostname: "www.googleapis.com",
    path: "/gmail/v1/users/" + option.IAM_MAIL_IMPERSONATE + "/messages/send?uploadType=multipart",
    method: "POST",
    headers: {
      "Authorization": joinBearer(option.BEARER),
      "Content-Type": "application/json"
    }
  };

  const req = https.request(options, function(res) {

     res.setEncoding("utf8");
     const data = [];

     res.on("data", function(chunk) {
       data.push(chunk)
     });

     res.on("end", function() {

       const res = data.reduce(function(bucket, buf){
         return bucket.concat(buf.toString())
       }, "");

       cb(null, JSON.parse(res))

     })

   });

  req.on("error", function(e) {
     cb(e)
   });

  req.write(dataSerialized);
  req.end();

}


//
// these are the loop tools for the timeout flow
//
function stopRunning(){

  return Date.now().valueOf() - start.valueOf() > millimit

}

function reRun(task){

  if (typeof task[0] === "function" || (typeof task[1] === "object" && task.length > 1)){
    failedTasks.push([task[0], task[1]]);

    const toReRun = new Set(failedTasks.splice(0, failedTasks.length));

    return backToTheFuture(toReRun)
  }else{
    llog("reRun fn is not usable... returning ");
    return
  }

}

function backToTheFuture(stack){

  return stack.forEach(function(ft){

    const ftname = typeof ft === "function" ? ft.name : ft[0].name
    const doLater = setTimeout(function(){
      if (typeof ft === "function"){
        return ft(options)
      }

      if (typeof ft === "object" && ft.length > 1){
        return ft[0](ft[1])
      }
      return ft.length ===1 ? ft[0]() : 0x0
    }, ftname === "statusCheck" ? globalTimeOut : 0)

   timeoutHits.push([ftname, doLater])

  })

}

function statusCheck(option){

  const notDoneTasks = toDoTasks;

  if (doneTasks.length < Object.entries(notDoneTasks).length && !stopRunning()){

    timeBrain(notDoneTasks, option)
    return reRun([statusCheck, option])

  } else {
    llog(doneTasks);
    llog("job done!\n")
    llog("timeout hits.. " + timeoutHits.length)
    llog("time took... " + (Date.now().valueOf() - start.valueOf())/1000)
    return 0x0
  }

}

function zeroPass(toDoTasks, option){

  return Object.entries(toDoTasks)
    .reduce(function(bucket, tdt){

      if (!tdt[1].requires.length > 0){
        failedTasks.push([tdt[1].fn, option]);
        return bucket
      }

      bucket.push(tdt);
      return bucket

    }, [])

}

function nthPass(toDoTasks, option){

  return Object.entries(toDoTasks)
    .reduce(function(bucket, remaining){

      if (hasRequirements(remaining) && nonBlocking(remaining) && notRunning(remaining)){
        failedTasks.push([remaining[1].fn, option]);
        bucket.push(remaining)
      }

      return bucket

    }, [])

}

function timeBrain(toDoTasks, option){
  // if is loop run, start all tasks that have their requirements fullfilled
  if (statusCheckStarted){
    return nthPass(toDoTasks, option)
  }
  // if is first run do task without requirements
  return zeroPass(toDoTasks, option)

}


//
// promised brain flow
//
function promisifyAll(){
  return {
    persistWeatherP: util.promisify(persistWeather),
    unlinkLastP: util.promisify(unlinkLast),
    linkLastP: util.promisify(linkLast),
    getTodaysWeatherP: util.promisify(getTodaysWeather),
    getYesterdaysWeatherP: util.promisify(getYesterdaysWeather),
    doMailP: util.promisify(doMail)
  }
}

function promisedBrain(option){

  const p = promisifyAll();

  Promise.all([
    p.getTodaysWeatherP(option),
    p.getYesterdaysWeatherP(option)
  ])
  .then(
    function(data){
      const persistOption = getPersistOption(option, data);
      return Promise.all([
        p.persistWeatherP(persistOption),
        p.unlinkLastP(option),
        data
      ])

    },
    function(err){

      if (err.code === "ENOENT"){
        return Promise.all([
          p.getTodaysWeatherP(option)
        ])
      }

    }
  )
  .then(
    function(data){
      const persistOption = getPersistOption(option, data)

      if (persistOption && (persistOption.data || data.length > 2)){
        return Promise.all([
          p.persistWeatherP(persistOption),
          data[2] || data
        ])
      }
      return "no data found no file saved or linked and no mail send"

    },
    function(err){
      llog("step two error: openweathermap call", err)
    }
  )
  .then(
    function(data){
      return Promise.all([
        p.linkLastP(option),
        data
      ])
    },
    function(err){
      llog("step three error", err)
    }
  )
  .then(
    function(data){
      option.msg = {
        weatherDiff:extractWeatherDiff(data[1][1])
      };
      return Promise.all([
        p.doMailP(option)
      ])
    },
    function(err){
      llog("step four error..", err);
    }
  )
  .then(
    function(data){
      llog("final data..", data);
      llog("time took... " + (Date.now().valueOf() - start.valueOf())/1000)
    },
    function(err){
      llog("final error..", err);
      llog("time took... " + (Date.now().valueOf() - start.valueOf())/1000)
    }
  )
}


//
// business functions
//
function getYesterdaysWeather(option, cb){

  !cb && (cb = noop)

  const getYesterdaysWeatherArguments = arguments;
  return fs.stat(option.lastDataFile, function(err, data){
    if (err){
      return cb(err)
    }

    return fs.readFile(option.lastDataFile, function(err, data){

      if (err){
        return cb(err)
      }

      if(!err){
        const taskData = {};
        taskData[getYesterdaysWeather.name] = JSON.parse(data.toString())
        doneTasks.push(taskData)
        return cb(null, taskData)
      }

    })

  })

}

function getTodaysWeather(option, cb){

  !cb && (cb = noop)

  const getTodaysWeatherArguments = arguments;

  const req = http.request(option.weatherUrl, function(res){

    const data = [];

    res.on("data", function(chunk){
      data.push(chunk)
    });

    res.on("end", function(){

      const res = data.reduce(function(bucket, buf){
        return bucket.concat(buf.toString())
      }, "");

      const taskData = {};
      taskData[getTodaysWeather.name] = JSON.parse(res.toString())

      doneTasks.push(taskData)
      return cb(null, taskData)

    })

  });

  req.on("error", function(err){
    const sheduled = failedTasks.filter(function(ft){return ft.name === getTodaysWeather.name }).length === 1;
    !sheduled && failedTasks.push([getTodaysWeather, getTodaysWeatherArguments]);
    return cb(err)
  });

  req.end()

}

function persistWeather(option, cb){

  !cb && (cb = noop)

  const fname = persistWeather.name
  const goodToGo = taskStatus(persistWeather, option);

  if (goodToGo && goodToGo.length > 0) {
    const weather = getWeatherData(goodToGo);
    const nextFileName = option.nextLast
    if (!weather["dt"]){
      return cb("payoad does not have a datetime")
    }

    return fs.writeFile(nextFileName, JSON.stringify(weather), function(err, data){

      if (err){
        return cb(err)
      }

      if(!err){
        const task = {};
        task[fname] = {
          filecontent: weather,
          filename: nextFileName
        }
        doneTasks.push(task)
        return cb(null, task)
      }

    })

  }

}

function compareWeather(option, cb){

  !cb && (cb = noop)
  const fname = compareWeather.name
  const goodToGo = taskStatus(compareWeather, option);

  if (goodToGo) {
    const task = {};
    task[fname] = extractWeatherDiff(goodToGo)
    doneTasks.push(task)
    return cb(null, task)
  }

  return cb("compareWeather failed")
}

function doMail(option, cb){

  !cb && (cb = noop)
  const fname = doMail.name

  const goodToGo = option.msg && option.msg.weatherDiff ? option.msg : taskStatus(doMail, option);

  if (goodToGo){
    option.body = JSON.stringify(goodToGo);

    if (option.BEARER){
      return sendMail(option, function(err, data){
        if (err){
          return cb(err)
        }
        const task = {};
        task[fname] = goodToGo
        doneTasks.push(task)
        return cb(null, task)
      })
    }

    return encodeJWT(option.IDENTITY_PATH, option.IAM_MAIL_IMPERSONATE, option.GSSCOPE, function(err, jwt){

      if (!err){
        return getBearer(jwt, function(err, bearer){
          if (!err){
            option.BEARER = JSON.parse(bearer).access_token
            return sendMail(option, function(err, data){
              if (err){
                return cb(err)
              }
              const task = {};
              task[fname] = goodToGo
              doneTasks.push(task)
              return cb(null, task)
            })
          }

          return cb("getBearer failed")

        })

      }

      return cb("encodeJWT failed")

    })

  }

  return cb("doMail not good to go")
}

function unlinkLast(option, cb){

  !cb && (cb = noop)
  const fname = unlinkLast.name

  return fs.stat(option.lastDataFile, function(err, data){

    if(err){
      return cb(err)
    }

    return fs.unlink(option.lastDataFile, function(err, data){
      if(err){
        return cb(err)
      }
      const task = {};
      task[fname] = option
      doneTasks.push(task)
      return cb(null, task)
    })
  })

}

function linkLast(option, cb){

  !cb && (cb = noop)
  const fname = linkLast.name

  return fs.symlink(option.link.nextLast, option.link.last, function(err, data){
    if(err){
      return cb(err)
    }
    const task = {};
    task[fname] = option
    doneTasks.push(task)
    return cb(null, task)
  })

}


//
// boot process
//
function setBootOps(option, requiredBootOpts, realBootops){

  return requiredBootOpts.filter(function(opt){
    const foundOpt = realBootops[opt];
    if (foundOpt){
      option[opt] = foundOpt;
      return true
    }
    return false
  }).length === requiredBootOpts.length

}

const requiredBootOpts = [
  "IDENTITY_PATH",
  "IAM_MAIL_IMPERSONATE",
  "APIID",
  "CITYID"
];

const realBootops = process.argv.reduce(function(ops, op){
  const keyVal = op.split("=");
  if(keyVal){
    ops[keyVal[0]] = keyVal[1];
  }
  return ops
}, {})

if (setBootOps(option, requiredBootOpts, realBootops)){

  const weatherUrl = option.WEATHER_BASE_URL + "id=" +  option.CITYID + "&APPID=" + option.APIID;
  option.weatherUrl = new URL(weatherUrl);

  if (process.argv[2] === "p"){
    promisedBrain(option)
  }else{
    statusCheck(option);
    statusCheckStarted = true
  }

} else {
  llog("required options not provided")
}


// log end of pass zero
startLogging = true
// done

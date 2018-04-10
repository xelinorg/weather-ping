"use strict";


//
// lib and utils
//
const util = require("util"),
  setTimeoutPromise = util.promisify(setTimeout),
  fs = require("fs"),
  http = require("http"),
  https = require("https"),
  URL = require("url").URL,
  crypto = require("crypto"),
  path   = require("path");

//
// g suite settings
//
const IDENTITY_PATH = path.normalize("./crypto/sysaaa-weather-ping-871c7f76d7d5.json"),
  IAM_MAIL_IMPERSONATE = "alex@systemics.gr",
  GS_SERVICE_ACCOUNT = "sysaaa@weather-ping.iam.gserviceaccount.com",
  GSSCOPE = "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.compose",
  BEARER = [];

//
// openweathermap settings
//
const APIID = "5378492d8248683e1e16176d90e68731",
  CITYID= "264371",
  WEATHER_BASE_URL = "http://api.openweathermap.org/data/2.5/weather?";

//
// own variables
//
const weatherUrl =  WEATHER_BASE_URL + "id=" +  CITYID + "&APPID=" + APIID,
  options = new URL(weatherUrl),
  dataFileBaseName = ".weather.json",
  lastDataFile = "last" + dataFileBaseName,
  start = Date.now(),
  doneTasks = [],
  failedTasks = [],
  timeoutHits = [],
  millimit = 12000,
  llogQueue = [],
  libroot = process.cwd(),
  dataDir = libroot + "/data/",
  globalTimeOut = 500,
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
    sendWeatherDiff: {
      isDone: function(){
        return isDone("sendWeatherDiff")
      },
      fn: sendWeatherDiff,
      requires:[
        "compareWeather"
      ]
    },
    updateLastWeatherLink: {
      isDone: function(){
        return isDone("updateLastWeatherLink")
      },
      fn: updateLastWeatherLink,
      requires: [
        "persistWeather"
      ]
    },
  };

let statusCheckStarted = false,
  startLogging = false,
  subscribers = ["xelinorg@gmail.com", "alexg@projectbeagle.com"];


//
// util functions
//
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

function getSubscribers(){
  return subscribers.reduce(function(bucket, bcc){
    bucket = bucket + ", <" + bcc + ">"
    return bucket
  }, "<" + IAM_MAIL_IMPERSONATE + ">")
}

function isDone(taskName){
  return doneTasks.filter(function(t){
    return getKey(t) === taskName
  }) === 1;
}

function getKey(container){
  return Object.keys(container)[0]
}

function taskStatus(fn){
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
    failedTasks.push([fn]);
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
      !sheduled && failedTasks.push([fn])
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
  return fs.stat(addDataDir(lastDataFile), function(err, data){
    if(err){
      return unlinkHandler({err: err})
    }
    return fs.unlink(addDataDir(lastDataFile), function(err, data){
      if(err){
        return unlinkHandler({err: err})
      }
      return unlinkHandler({err: err, data: data})
    })
  })
}

function linkLast(newWeatherFile, fn, linkHandler ){
  const fname = fn.name;
  const linkFile = addDataDir(lastDataFile);

  return fs.symlink(newWeatherFile, linkFile, function(err, data){
    if(err){
      return linkHandler({err: err})
    }
    return linkHandler({err: err, data: data})
  });
}


//
// http request handlers
//
function httpResponseHandler(res){

  const data = [];

  res.on("data", function(chunk){
    data.push(chunk)
  });

  res.on("end", function(){

    const res = data.reduce(function(bucket, buf){
      return bucket.concat(buf.toString())
    }, "");

    const weatherPayload = JSON.parse(res.toString());

    doneTasks.push({getTodaysWeather: weatherPayload})

  });
}

function httpErrorHandler(err){
  llog("problem with request: " + err.message);
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
    "iss": GS_SERVICE_ACCOUNT,
    "sub": IAM_MAIL_IMPERSONATE,
    "scope": GSSCOPE,
    "aud": "https://www.googleapis.com/oauth2/v4/token",
    "exp": iatExpPair.EXP,
    "iat": iatExpPair.IAT
  }

  return JWT_DWD_CLAIM
}

function signJWT(token, cb) {

    var sign = crypto.createSign("RSA-SHA256");

    fs.readFile(IDENTITY_PATH, function(err, data){

      if (err){
        throw err
      }

      sign.update(token);
      return cb(sign.sign(getKeyFromIdentityMap(data), "base64"))

    })
}

function encodeJWT(cb){

  const iatExpPair = getIatExpPair(),
    jwtBasePair = {
      header: JWT_HEADER,
      body: getJwtDwdClaim(iatExpPair)
    },
    jwtBasePairEncoded = {};

  Array.from(Object.entries(jwtBasePair)).reduce(function(bucket, item){
    bucket[item[0]] = Buffer.from(JSON.stringify(item[1])).toString("base64");
    return bucket
  }, jwtBasePairEncoded);

  const jwtBaseEncoded = jwtBasePairEncoded.header + "." + jwtBasePairEncoded.body;

  return signJWT(jwtBaseEncoded, function(jwtBaseSigned){

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
    console.error("problem with request: " + e.message);
    cb(e)
  });

 req.write(postData);
 req.end();

}

function getMsg(body, ts){

  const msgTS = ts || (new Date(Date.now())).toUTCString()

  const msg = "To: <" + IAM_MAIL_IMPERSONATE + ">" + "\n" +
    "From: <" + IAM_MAIL_IMPERSONATE + ">" + "\n" +
    "Bcc: " + getSubscribers() + "\n" +
    "Subject: weather-ping" + "\n" +
    "Date: " + msgTS + "\n" +
    "Content-Type: text/plain; charset=\"UTF-8\"" + "\n\n" +

    "This is the weather ping. And the diff is..." + "\n\n" +

    body + "\n\n" +

    "Bye Bye for now!" + "\n";

  return msg

}

function getMsgEncoded(msg){

  const tmpmsg = getMsg(msg);
  const bufferedToBase64 = Buffer.from(tmpmsg).toString("base64");

  return Base64EncodeUrl(bufferedToBase64)

}

function sendMail(bearer, msg, cb) {

  const postData = {
    raw: getMsgEncoded(msg)
  },
  dataSerialized = JSON.stringify(postData);

  const options = {
    hostname: "www.googleapis.com",
    path: "/gmail/v1/users/" + IAM_MAIL_IMPERSONATE + "/messages/send?uploadType=multipart",
    method: "POST",
    headers: {
      "Authorization": joinBearer(bearer),
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
     console.error("problem with request: " + e.message);
     cb(e)
   });

  req.write(dataSerialized);
  req.end();

}

function doMail(msg, cb){

  const serializedMsg = JSON.stringify(msg);

  if (BEARER.length > 0){
    return sendMail(BEARER[0], serializedMsg, cb)
  }

  return encodeJWT(function(err, jwt){
    if (!err){

      return getBearer(jwt, function(err, bearer){

        if (!err){
          BEARER.push(JSON.parse(bearer).access_token)
          return sendMail(BEARER[0], serializedMsg, cb)
        }

        return cb("getBearer failed")

      })

    }

    return cb("doMail failed")

  })

}


//
// these are the loop tools
//
function stopRunning(){

  return Date.now().valueOf() - start.valueOf() > millimit

}

function reRun(fn, options){



  if (typeof fn !== "function" || (typeof fn === "object" && fn.length > 1)){
    llog("reRun fn is not usable... returning ");
    return
  }

  failedTasks.push(fn);

  const toReRun = new Set(failedTasks.splice(0, failedTasks.length));
  //console.log(toReRun)

  return backToTheFuture(toReRun)

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
    }, ftname === "statusCheck" ? 33 : 0)

   timeoutHits.push([ftname, doLater])

  })

}

function statusCheck(options){

  const notDoneTasks = toDoTasks;

  const fn = statusCheck;

  if (doneTasks.length < Object.entries(notDoneTasks).length && !stopRunning()){

    brain(notDoneTasks)
    return reRun(fn, options)

  } else {
    llog(doneTasks);
    llog("job done!\n")
    llog("timeout hits.. " + timeoutHits.length)
    llog("time took... " + (Date.now().valueOf() - start.valueOf())/1000)
    return 0x0
  }

}

function brain(toDoTasks){
  // if is loop run, start all tasks that have their requirements fullfilled
  if (statusCheckStarted){

    return Object.entries(toDoTasks)
      .reduce(function(bucket, remaining){

        if (hasRequirements(remaining) && nonBlocking(remaining) && notRunning(remaining)){
          failedTasks.push(remaining[1].fn);
          bucket.push(remaining)
        }

        return bucket

      }, [])

  }

  // if is first run do task without requirements
  return Object.entries(toDoTasks)
    .reduce(function(bucket, ndt){

      if (!ndt[1].requires.length > 0){
        failedTasks.push(ndt[1].fn);
        return bucket
      }

      bucket.push(ndt);
      return bucket

    }, [])

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
  //llog("on getYesterdaysWeather")

  const fname = getYesterdaysWeather.name
  const lastFileName = dataDir + lastDataFile

  readFromFile(lastFileName, getYesterdaysWeather, function(data){
    const task = {};
    task[fname] = JSON.parse(data.toString())
    return doneTasks.push(task)
  })

}

function getTodaysWeather(){
  //llog("on getTodaysWeather")

  const req = http.request(options, httpResponseHandler);

  req.on("error", httpErrorHandler);

  req.end();

}

function persistWeather(){
  //llog("on persistWeather")

  const fname = persistWeather.name
  const goodToGo = taskStatus(persistWeather);

  const weather = getWeatherData(goodToGo);
  const nextFileName = dataDir + Date.now().valueOf() + dataFileBaseName

  if (goodToGo) {
    if (!weather["dt"]){
      return failedTasks.push([persistWeather])
    }
    return writeToFile(nextFileName, weather, persistWeather)
  }

}

function compareWeather(){
  //llog("on compareWeather")

  const fname = compareWeather.name
  const goodToGo = taskStatus(compareWeather);

  if (goodToGo) {
    const task = {};
    task[fname] = extractWeatherDiff(goodToGo)
    return doneTasks.push(task)
  }

  return [fname, false, "not good to go"]
}

function sendWeatherDiff(){
  //llog("on sendWeather")

  const fname = sendWeatherDiff.name
  const goodToGo = taskStatus(sendWeatherDiff);

  if (goodToGo) {

    return doMail(goodToGo[0], function(err, mailReceipt){

      if (!err) {
        const task = {};
        task[fname] = mailReceipt
        doneTasks.push(task)
        return [fname, true]
      }

      const sheduled = failedTasks.filter(function(ft){return ft.name === fname }).length === 1
      !sheduled && failedTasks.push([sendWeatherDiff])
      return [fname, false, err]

    })

  }
  return [fname, false, "not good to go"]
}

function updateLastWeatherLink(){
  //llog("on updateLastWeatherLink")

  const fname = updateLastWeatherLink.name
  const goodToGo = taskStatus(updateLastWeatherLink);
  if (goodToGo) {
    const nextLastFile = goodToGo[0].persistWeather.filename;

    return unlinkLast(updateLastWeatherLink, function(res){
      if(res.err){
        failedTasks.push(updateLastWeatherLink)
        return [fname, false, res.err]
      }
      return linkLast(nextLastFile, updateLastWeatherLink, function(res){
        if(res.err){
          failedTasks.push(updateLastWeatherLink)
          return [fname, false, res.err]
        }

        if(!toDoTasks[fname].isDone()){
          const task = {};
          task[fname] = {
            nextLastFile: nextLastFile
          }
          doneTasks.push(task)
          return [fname, true]
        }

      })

    })

  }

  return [fname, false, "not good to go"]
}


statusCheck()
statusCheckStarted = true;

// log end of pass zero
startLogging = true

// done

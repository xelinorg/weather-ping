"use strict";


const   URL = require("url").URL,
  http = require("http"),
  https = require("https"),
  util = require("util"),
  fs = require("fs"),
  crypto = require("crypto"),
  path = require("path");


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
const weatheRawrUrl =  WEATHER_BASE_URL + "id=" +  CITYID + "&APPID=" + APIID,
  weatherUrl = new URL(weatheRawrUrl),
  dataFileBaseName = ".weather.json",
  dataDir = process.cwd() + "/data/",
  lastDataFile = dataDir + "last" + dataFileBaseName,
  nextLast = dataDir + Date.now().valueOf() + dataFileBaseName,
  subscribers = ["xelinorg@gmail.com"],
  start = Date.now();

const option = {
  nextLast: nextLast,
  dataDir: dataDir,
  lastDataFile: lastDataFile,
  weatherUrl: weatherUrl,
  link: {
    nextLast: nextLast,
    last: lastDataFile
  }
}


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

function hasTodaysWeather(data){
  const getTodaysWeather = data.filter(function(entry){
    if (entry.getTodaysWeather){
      return true
    }
    return false
  })

  if (getTodaysWeather && getTodaysWeather.length > 0 && getTodaysWeather[0].getTodaysWeather){
    return true
  }
  return false
}

function dataToMailBody(data){
  return data.filter(function(entry){
    if (entry.dataP){
      return true
    }
    return false
  })[0].dataP
}

function getPersistOption(option, data){
  const persistOption = {
    nextLast: option.nextLast,
    data: data.filter(function(task){
      if (Object.keys(task)[0] === "getTodaysWeather"){
        return true
      }
      return false
    })
  }
  return persistOption
}

function hasData(dataBox){
  return dataBox ? dataBox.data : false
}

function hasTheOptionKeys(option, keysToHave){
  const optionKeys = Object.keys(option);

  return keysToHave.filter(function(key){
    return optionKeys.indexOf(key) > -1
  }).length === keysToHave.length

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


//
// business
//
function getYesterdaysWeather(options, cb){

  fs.readFile(options, function(err, data){

    if (err){
      return cb(err)
    }

    if(!err){
      return cb(null, { getYesterdaysWeather: JSON.parse(data.toString()) })
    }

  })

}

function getTodaysWeather(options, cb){

  const req = http.request(options, function(res){
    const data = [];

    res.on("data", function(chunk){
      data.push(chunk)
    });

    res.on("end", function(){

      const res = data.reduce(function(bucket, buf){
        return bucket.concat(buf.toString())
      }, "");

      return cb(null, {getTodaysWeather: JSON.parse(res.toString())})

    });
  });

  req.on("error", function(err){
    return cb(err)
  });

  req.end();

}

function persistWeather(option, cb){

  return fs.writeFile(option.nextLast, JSON.stringify(option.data[0].getTodaysWeather), function(err){

    if (err){
      return cb(err)
    }

    if(!err){
      return cb(null, { persistWeather:true})
    }

  })

}

function unlinkLast(option, cb){

  return fs.unlink(option, function(err, data){
    if(err){
      return cb(err)
    }
    return cb(null, {unlinkLast: true})
  })

}

function linkLast(option, cb){

  return fs.symlink(option.nextLast, option.last, function(err, data){
    if(err){
      return cb(err)
    }
    return cb(null, {linkLast: true})
  })

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
// brain stuff :p
//
function promisifyAll(){
  return {
    persistWeatherP: util.promisify(persistWeather),
    unlinkLastP: util.promisify(unlinkLast),
    linkLastP: util.promisify(linkLast),
    getTodaysWeatherP: util.promisify(getTodaysWeather),
    getYesterdaysWeatherP: util.promisify(getYesterdaysWeather)
  }
}

function brain(option){

  const p = promisifyAll();

  Promise.all([
    p.getTodaysWeatherP(option.weatherUrl),
    p.getYesterdaysWeatherP(option.lastDataFile)
  ])
  .then(
    function(data){

      const persistOption = getPersistOption(option, data);

      return Promise.all([
        p.persistWeatherP(persistOption),
        p.unlinkLastP(option.lastDataFile),
        p.linkLastP(option.link),
        {dataP:data}
      ])

    },
    function(err){

      if (err.code === "ENOENT"){
        return Promise.all([
          p.getTodaysWeatherP(option.weatherUrl)
        ])
      }

    }
  )
  .then(
    function(data){

      if (data && data.length){

        if (hasTodaysWeather(data)){

          const persistOption = getPersistOption(option, data)

          return Promise.all([
            p.persistWeatherP(persistOption),
            p.linkLastP(option.link)
          ])

        }

        const doMailP = util.promisify(doMail);
        const mailBody = dataToMailBody(data);

        if (mailBody){
          return Promise.all([doMailP(mailBody)])
        }else{
          return "no mailBody found to send"
        }

      }

      return "no data found no file saved or linked and no mail send :)"

    },
    function(err){
      console.log("step two error", err)
    }
  )
  .then(
    function(data){
      console.log("final data..", data)
    },
    function(err){
      console.log("final error..", err)
    },
    function(){
      console.log("time took... " + (Date.now().valueOf() - start.valueOf())/1000)
    }
  )

}

brain(option)

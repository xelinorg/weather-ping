`weather-ping` is a utility algorithm that retrieves, compares, stores and forwards the temperature on a city given a city code. It is a command line utility and not a node module.

This a POC work and it does not provide something meaningful and it could be used more for comparing and learning some scripting concepts. The g suite mailing functions could be prove useful though. 


Inside the project root directory execute

For promised flow run
```
$ node index.js p IDENTITY_PATH=./crypto/alpha.json IAM_MAIL_IMPERSONATE=alpha@alpha.alpha APIID=5378492d8248683e1e16176d90e68731 CITYID=264371
```

For the timeouted flow run
```
$ node index.js IDENTITY_PATH=./crypto/alpha.json IAM_MAIL_IMPERSONATE=alpha@alpha.alpha APIID=5378492d8248683e1e16176d90e68731 CITYID=264371
```

The code has been developed and tested using `node-v8.9.1`

You will need an account on `G Suite` and one on `OpenWeatherMap`.

The working authentication is implementing machine-2-machine logic and works without user interaction. It needs some configuration thought on the security section of the g suite admin and in particular under advanced settings and authentication(manage api client access). Here the required is to give the client id of the service account and the scopes of the token to be issued. The service account has to be created with domain wide delegation(DWD) enabled and to have been assigned the token creator role.  

There should be an `cron` entry as there is not build-in function to do
the scheduling from within the algorithm.

There is need for more/correct error handling on both flows and in general.

The initial thought for a "pure node/third-party free" code has been met giving a big satisfaction to the author.  

A sample cronjob entry could be this.

```
2 1 * * * SHELL=/bin/bash ; bash ~/weather-ping/preferred_flow.sh > /dev/null 2>&1
```

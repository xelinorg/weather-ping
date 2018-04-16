`weather-ping` is a utility algorithm that retrieves, compares, stores and forwards the temperature on a city given a city code. It is a command line utility and not a node module.


Inside the project root directory execute

For promised flow run
```
$ node promised_weather.js
```

For the timeouted flow run
```
$ node index.js
```

The code has been developed and tested using `node-v8.9.1`

You will need an account on `G Suite` and one on `OpenWeatherMap`.

The working authentication is implementing machine-2-machine logic and works without user interaction. It needs some configuration thought on the security section of the g suite admin and in particular under advanced settings and authentication(manage api client access). Here the required is to give the client id of the service account and the scopes of the token to be issued. The service account has to be created with domain wide delegation(DWD) enabled and to have been assigned the token creator role.  

There should be an `cron` entry as there is not build-in function to do
the scheduling from within the algorithm.

There is an issue with the data file inside the data directory.
This issue remain for the timeouted version since on the promised one if does not find the file will create it.

So The `last.weather.json` has to be linked manually the first time or we will never
get the comparison done and the email send or if the promised version run it gets linked with the result of that run.

There is need for more/correct error handling on both versions.

The initial thought was for a "pure node/third-party free" code. The target has been met but the code has to be modularized outside the main files.  

A sample cronjob entry could be this.

```
2 1 * * * SHELL=/bin/bash ; bash ~/weather-ping/preferred_flow.sh > /dev/null 2>&1
```

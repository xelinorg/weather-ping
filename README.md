`weather-ping` is a utility algorithm that retrieves, compares, stores and forwards the temperature on a city given a city code. It is a command line utility and not a node module.


Inside the project root directory execute

```
$ npm install

$ node index.js
```

The code has been developed and tested using `node-v8.9.1`

You will need an account on `G Suite` and one on `OpenWeatherMap`.

The working authentication with google side is OAuth token based.

There is some code that partially implements machine-2-machine logic but that
does not work for sending mail as is now.

There should be an `cron` entry as there is not build-in function to do
the scheduling from within the algorithm.

There is an issue with the data file inside the data directory.
The `last.weather.json` has to be linked manually the first time or we will never
get the comparison done and the email send.

There is room for many improvements and a good refactoring.

The initial thought was for a "pure node/third-party free" code, but the raw implementation of gmail integration was not easy on the given time.  

A sample cronjob entry could be this. 

```
2 1 * * * SHELL=/bin/bash ; bash ~/weather-ping/weather_ping.sh > /dev/null 2>&1
```

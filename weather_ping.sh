#!/bin/bash

cd ~/weather-ping/

PATH=$PATH:~/.nvm/versions/node/v8.9.1/bin

node index.js > weather_ping.log

# node index.js IDENTITY_PATH=./crypto/sysaaa-weather-ping-871c7f76d7d5.json IAM_MAIL_IMPERSONATE=alex@systemics.gr APIID=5378492d8248683e1e16176d90e68731 CITYID=264371

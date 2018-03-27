#!/bin/bash

cd ~/weather-ping/

PATH=$PATH:~/.nvm/versions/node/v8.9.1/bin

node index.js > weather_ping.log

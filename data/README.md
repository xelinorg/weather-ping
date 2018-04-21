Keep this file for the on file system storage.

The storage works by saving the weather payload get form the weather api
into a timestamped file with filename pattern of 12345678909876.weather.json

It then checks for a link file of the name last.weather.json and if not present
creates the link to the timestamped file saved earlier. If present it unlinks the
linked file after it reads its content for the comparison that should happen in later stage.

Doing all the file system tasks is async by nature and could easily be replaced by a call to remote storage api.

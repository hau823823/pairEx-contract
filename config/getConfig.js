YAML = require('yamljs');

function GetConfig(){
  let nativeObject = YAML.load(__dirname+'/config.yaml');
  let jsonstr = JSON.stringify(nativeObject);
  return JSON.parse(jsonstr, null);
}

module.exports.GetConfig = GetConfig;
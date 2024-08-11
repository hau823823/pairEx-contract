cp deployData/dev_config.yaml ../../config/config.yaml
cp deployData/dev_unknown-421613.json .openzeppelin/unknown-421613.json
cp deployData/dev_contract_address.json contract_address.json
#
#cp deployData/releaseArbGoerli_config.yaml ../../config/config.yaml
#cp deployData/releaseArbGoerli_unknown-421613.json .openzeppelin/unknown-421613.json
#cp deployData/releaseArbGoerli_contract_address.json contract_address.json
#
#cp deployData/releaseArbOne_config.yaml ../../config/config.yaml
#cp deployData/releaseArbOne_unknown-42161.json .openzeppelin/unknown-42161.json
#cp deployData/releaseArbOne_contract_address.json contract_address.json

#npx hardhat run ./proxy_upgrade.js --network localhost --show-stack-traces
#npx hardhat run ./proxy_upgrade.js --network hardhat --show-stack-traces
npx hardhat run ./proxy_upgrade.js --network arbitrumGoerli  --show-stack-traces
#npx hardhat run ./proxy_upgrade.js --network arbitrumOne  --show-stack-traces

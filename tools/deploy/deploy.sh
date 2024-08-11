#cp deployData/dev_config.yaml ../../config/config.yaml
#cp deployData/releaseArbGoerli_config.yaml ../../config/config.yaml
cp deployData/releaseArbOne_config.yaml ../../config/config.yaml

#npx hardhat run ./deploy.js --network localhost --show-stack-traces
#npx hardhat run ./deploy.js --network hardhat --show-stack-traces
#npx hardhat run ./deploy.js --network arbitrumGoerli  --show-stack-traces
npx hardhat run ./deploy.js --network arbitrumOne  --show-stack-traces
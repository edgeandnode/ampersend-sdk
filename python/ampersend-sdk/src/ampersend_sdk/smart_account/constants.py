"""Smart account constants."""

# OwnableValidator address - ERC-7579 validator for smart accounts
# This is the standard validator used by most smart account implementations
OWNABLE_VALIDATOR = "0x000000000013fdB5234E4E3162a810F54d9f7E98"

# CoSignerValidator address - ERC-7579 validator requiring dual signatures (agent + server)
# Deployed via CREATE2 for deterministic address across chains
COSIGNER_VALIDATOR = "0x972F1d56Ec65248f57CF1204b2F012a3a2d7f82B"

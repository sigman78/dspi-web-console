# Changelog

All notable changes to dspi-web-console are documented here. Entries are
generated automatically by [release-please](https://github.com/googleapis/release-please)
from [Conventional Commit](https://www.conventionalcommits.org/) messages, and
this project follows [Semantic Versioning](https://semver.org/) (currently in the
`0.x` pre-1.0 line — minor versions may include breaking changes).

## [0.2.0](https://github.com/sigman78/dspi-web-console/compare/dspi-console-web-v0.1.0...dspi-console-web-v0.2.0) (2026-06-17)


### Features

* add /fw-watch firmware-tracking skill ([6553ca4](https://github.com/sigman78/dspi-web-console/commit/6553ca4b3c437280da0064c6c51302efab563c8c))
* **chrome:** active-expanded tabs; keep merged row to one line ([2c248f0](https://github.com/sigman78/dspi-web-console/commit/2c248f06a26e6b625d42b4f09514300daba4ab48))
* **chrome:** carry connection state in the brand cube; conditional status pill ([8759277](https://github.com/sigman78/dspi-web-console/commit/8759277e1fd5db97174262e8383a627cbaeb53be))
* **chrome:** ChannelRail grouped channel selector ([7f7605b](https://github.com/sigman78/dspi-web-console/commit/7f7605bbf66bb1faa13f02b7bcba36b9cd479e1f))
* **chrome:** ChannelRow selectable channel button ([af30c4a](https://github.com/sigman78/dspi-web-console/commit/af30c4a5cbe53731d73d81e9c022ab674914d042))
* **chrome:** cube-only status; tabs expand when wide; compact stats ([f35d7b5](https://github.com/sigman78/dspi-web-console/commit/f35d7b5edf5f1006fcd42d307534efa9c7dbec35))
* **chrome:** drop whole stats block at once, delay tab collapse; hide version/gh ([68e5f52](https://github.com/sigman78/dspi-web-console/commit/68e5f529c5217640d503a4702cb2858f3a9484e8))
* **chrome:** inline channel rename in the sidebar rail ([7d5cfc2](https://github.com/sigman78/dspi-web-console/commit/7d5cfc2293b55ad04597e4f85071360d38c9f48b))
* **chrome:** label the rail preset header ([faf452b](https://github.com/sigman78/dspi-web-console/commit/faf452b846f92fbaf16974556343a8003d47ca1b))
* **chrome:** make disabled channels non-selectable in the rail ([87f18c6](https://github.com/sigman78/dspi-web-console/commit/87f18c63a40b20bc950d5a89163ae2bb22004e1f))
* **chrome:** merge tab bar into the single top row ([e478326](https://github.com/sigman78/dspi-web-console/commit/e4783261bff9afce9f2be4527970783a9730741b))
* **chrome:** move active-preset chip to the channel rail header ([dd8d749](https://github.com/sigman78/dspi-web-console/commit/dd8d7494e1227121b2f8d73ee4c16b7c3ff15e58))
* **chrome:** progressive hide order for the single top row ([0e3f7b5](https://github.com/sigman78/dspi-web-console/commit/0e3f7b53cabdebc982b840463a00fd7448b4916a))
* **domain:** groupIntoPairs channel grouping helper ([786f52c](https://github.com/sigman78/dspi-web-console/commit/786f52cbed400128ffe828aa3535eb797ef94af4))
* **eq:** full sine glyph for active bypass state ([9eaac84](https://github.com/sigman78/dspi-web-console/commit/9eaac846e9c8a3d83a1a31b94893329977029ab4))
* **eq:** wave/line band bypass toggle; fix band table alignment ([23b88c4](https://github.com/sigman78/dspi-web-console/commit/23b88c4c01bfc1234a744c6593a37955810ca85a))
* **mixer:** locate the selected channel in the routing matrix ([2215f2c](https://github.com/sigman78/dspi-web-console/commit/2215f2c758e043b5485319c41c16385ba7db5b29))
* **shell:** mount ChannelRail beside tab content ([b20d1d8](https://github.com/sigman78/dspi-web-console/commit/b20d1d817032a8f0cec45d6bdb02c88d92a1de66))
* **state:** selectChannel action (set eq target + jump to EQ) ([bc1eaec](https://github.com/sigman78/dspi-web-console/commit/bc1eaecd24ef3b165e30bf9317f87eaef9863ada))


### Bug Fixes

* **chrome:** keep selected ChannelRow legible while hovered ([38c4304](https://github.com/sigman78/dspi-web-console/commit/38c4304d022f6e0a078c11ec5ba94ab4a9ff01de))
* **chrome:** keep status pill at intrinsic height in the merged bar ([cef2e76](https://github.com/sigman78/dspi-web-console/commit/cef2e76027088f2d7748be4ce02d4a37dbda0b10))
* **chrome:** keep whole rename row clickable; scope edit focus-return to keyboard ([8d5bc9c](https://github.com/sigman78/dspi-web-console/commit/8d5bc9c8c087949d6d6e6c37b056bcb659b8f2c3))
* **chrome:** remove dead-zone ring around channel select target ([b1739ee](https://github.com/sigman78/dspi-web-console/commit/b1739ee99fb88f8abe9af4f1707451e8b0fe3648))
* **eq:** align numeric band headers over their values ([204c5b7](https://github.com/sigman78/dspi-web-console/commit/204c5b7af385faa43092253d31425436e31b4bf0))
* **eq:** point channel-select copy at the left rail ([558175b](https://github.com/sigman78/dspi-web-console/commit/558175b07926e24ce71efbe5a4a87e6827abb18d))
* **fw-watch:** correct rebase-detection, dedup key, and minor skill wording ([f681500](https://github.com/sigman78/dspi-web-console/commit/f68150072d48c464eeea3d68d1f6cddda0bc5ad8))
* **fw-watch:** leave section untouched on no-op runs ([931971e](https://github.com/sigman78/dspi-web-console/commit/931971e84359762867a4b19bb49903167b02ce3c))
* **ui:** better disabled hatching ([046b664](https://github.com/sigman78/dspi-web-console/commit/046b66445b211b2e8c69f8a42acd99a1cec58195))

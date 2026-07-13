# Changelog

All notable changes to dspi-web-console are documented here. Entries are
generated automatically by [release-please](https://github.com/googleapis/release-please)
from [Conventional Commit](https://www.conventionalcommits.org/) messages, and
this project follows [Semantic Versioning](https://semver.org/) (currently in the
`0.x` pre-1.0 line — minor versions may include breaking changes).

## [0.6.0](https://github.com/sigman78/dspi-web-console/compare/dspi-console-web-v0.5.0...dspi-console-web-v0.6.0) (2026-07-13)


### Features

* **control-surfaces:** CS v2/v3 migration and IR remote command editor ([#76](https://github.com/sigman78/dspi-web-console/issues/76)) ([3ebde20](https://github.com/sigman78/dspi-web-console/commit/3ebde206b38684450067c6d13b04346e233dc570))
* **eq:** fw wire V22-V24 support and Linkwitz Transform filter ([#79](https://github.com/sigman78/dspi-web-console/issues/79)) ([a78c863](https://github.com/sigman78/dspi-web-console/commit/a78c8632ad11fa13e2405bd4752a673c97eb16c0))
* **processing:** per-output loudness and per-pair crossfeed masks (fw V19/V20) ([#77](https://github.com/sigman78/dspi-web-console/issues/77)) ([568e65e](https://github.com/sigman78/dspi-web-console/commit/568e65eef10dc115f952cbcbb87a262ef6a22681))
* **system:** I2S slave clock mode support (fw wire V21) ([#78](https://github.com/sigman78/dspi-web-console/issues/78)) ([6630cab](https://github.com/sigman78/dspi-web-console/commit/6630cab237a5746ac357e65c4fa223fcae4ca091))
* **ui:** move rail VU meters below the channel button face ([#80](https://github.com/sigman78/dspi-web-console/issues/80)) ([433108a](https://github.com/sigman78/dspi-web-console/commit/433108a1a1c1c71e8567c240170f0133fbd68c1b))

## [0.5.0](https://github.com/sigman78/dspi-web-console/compare/dspi-console-web-v0.4.0...dspi-console-web-v0.5.0) (2026-07-10)


### Features

* multiple selectable S/PDIF inputs (fw 1.1.5) ([#68](https://github.com/sigman78/dspi-web-console/issues/68)) ([46d8af1](https://github.com/sigman78/dspi-web-console/commit/46d8af1af71ab46190adf66e2a194a75e8ca4887))
* **ui:** permanent mobile splash pointing phones to a PC ([#71](https://github.com/sigman78/dspi-web-console/issues/71)) ([d95c114](https://github.com/sigman78/dspi-web-console/commit/d95c1149d3cc137f30f914bc6618985a16e089a6))
* **ui:** segmented LED channel VU meters with per-channel row styling ([#70](https://github.com/sigman78/dspi-web-console/issues/70)) ([a4d7109](https://github.com/sigman78/dspi-web-console/commit/a4d710949bb0ad50873f4d8b1edef91002dcfcad))

## [0.4.0](https://github.com/sigman78/dspi-web-console/compare/dspi-console-web-v0.3.0...dspi-console-web-v0.4.0) (2026-07-09)


### Features

* **leveller:** channel-aware volume leveller with per-input detector/apply masks ([#66](https://github.com/sigman78/dspi-web-console/issues/66)) ([34fba15](https://github.com/sigman78/dspi-web-console/commit/34fba158888c2b7a37225cbb2ea480b9c4a0176d))

## [0.3.0](https://github.com/sigman78/dspi-web-console/compare/dspi-console-web-v0.2.0...dspi-console-web-v0.3.0) (2026-07-08)


### Features

* **bode:** crossover + first-order curves in the response plot ([2f156c6](https://github.com/sigman78/dspi-web-console/commit/2f156c6608abb44981052e9cdb8add230dcb5b2f))
* **eq:** AutoEQ profile library with user-saved entries ([5f60261](https://github.com/sigman78/dspi-web-console/commit/5f6026164bd733c483cecd5577427a4f50367bd6))
* **hero:** collapsed Linux USB setup guide on the connect screen ([f90c5a0](https://github.com/sigman78/dspi-web-console/commit/f90c5a04e3ae7e994b280c0470b268decbd04104))
* **linux:** one-line USB access setup script ([a2faae4](https://github.com/sigman78/dspi-web-console/commit/a2faae4b15fc579f31731b0b341a13d3564e20ce))
* **mixer:** follow the live active input count ([d1be6b3](https://github.com/sigman78/dspi-web-console/commit/d1be6b3a84abe27fa10747e2abb6899c5913477e))
* **notify:** name the UART/I2C param sources ([140b6dc](https://github.com/sigman78/dspi-web-console/commit/140b6dc3bc4077c7ce0cddb2b8b9f38d7fe49cfe))
* **pins:** dynamic control-interface pin ownership ([0c65db7](https://github.com/sigman78/dspi-web-console/commit/0c65db7748a78afcd6e9696b97e1b34234a0d1e2))
* **proto:** chunked bulk-params access for the WinUSB 4 KB cap ([486611f](https://github.com/sigman78/dspi-web-console/commit/486611f86bb5c979fdc846aeb070a17bfb2723e1))
* **proto:** dual-wire foundation for fw 1.1.5 (wire V16) ([3beeea0](https://github.com/sigman78/dspi-web-console/commit/3beeea086f7e288815df35f4634c63d179a94125))
* **proto:** external control-interface config surface ([84b664f](https://github.com/sigman78/dspi-web-console/commit/84b664ff11ccc28f77eef6089a924bac989ad4fe))
* **runtime:** V16 runtime wiring (input-format notify, meters remap, I2S + crossover actions) ([d84c31d](https://github.com/sigman78/dspi-web-console/commit/d84c31d3ff96b07a9c2a6920b353d7a77a2c92af))
* **transport:** serialize vendor control transfers ([728702b](https://github.com/sigman78/dspi-web-console/commit/728702bd46b90c023852f8af97f75161af7abef2))
* **ui:** control surfaces — bind physical controls on spare GPIOs ([976e523](https://github.com/sigman78/dspi-web-console/commit/976e523a8c7124712d3e85c672522ccefa41ae4f))
* **ui:** control-interfaces panel ([e718a07](https://github.com/sigman78/dspi-web-console/commit/e718a076bab2b2a85e73785f8bd22a14ef851d95))
* **ui:** dedicated Control tab for interfaces and surfaces ([0498e28](https://github.com/sigman78/dspi-web-console/commit/0498e28bd7eb2b3306ed0b3ecbcd90a53d87c5ea))
* **ui:** latest-changes panel on the overview tab ([9dbb422](https://github.com/sigman78/dspi-web-console/commit/9dbb422a77fbe1b4964799269ca298be5148e81c))
* **ui:** source-aware input names, pair output enables, hide disabled channels ([#63](https://github.com/sigman78/dspi-web-console/issues/63)) ([ee169c5](https://github.com/sigman78/dspi-web-console/commit/ee169c5dcbba33ddfb22ba32767cec510b2bb297))
* **ui:** stage heavy config changes behind a single apply gate ([4495ba1](https://github.com/sigman78/dspi-web-console/commit/4495ba19b166866cb873cb6922800d75d0285e91))
* **ui:** surface V16 features behind capability gates ([aa34854](https://github.com/sigman78/dspi-web-console/commit/aa348549bb1555fd847aae3ad287f8f4936994a5))


### Bug Fixes

* **hero:** drive "device in use" off claim failure, drop flaky cross-tab probe ([#58](https://github.com/sigman78/dspi-web-console/issues/58)) ([38a6a34](https://github.com/sigman78/dspi-web-console/commit/38a6a340b060f05a0332f5edf13f2966fe940f17))
* **hil:** survive first contact with 1.1.5-beta hardware ([568bc26](https://github.com/sigman78/dspi-web-console/commit/568bc2677c1d1c5aa2481069588ad249f9899739))
* **linux:** grant WebUSB access via MODE 0666 (uaccess-only fails on Arch) ([#57](https://github.com/sigman78/dspi-web-console/issues/57)) ([bbf7571](https://github.com/sigman78/dspi-web-console/commit/bbf7571ca57874ef5ac9a44229e945287be0f30d))
* **notify:** silently drain the ring backlog before going live ([57c1607](https://github.com/sigman78/dspi-web-console/commit/57c1607620d579f40565d99cfd82d49e0fd34692))
* **poll:** S/PDIF cadence never fires while performance.now() &lt; interval ([48a755f](https://github.com/sigman78/dspi-web-console/commit/48a755f00fc638cf25bd394eacab12b64c760188))
* **ui:** always-swap web fonts and skeleton the tab bar until device ready ([#64](https://github.com/sigman78/dspi-web-console/issues/64)) ([aaf5e9f](https://github.com/sigman78/dspi-web-console/commit/aaf5e9f4690e92df9fddc39cb702416ba09d8b6c))
* **ui:** eliminate first-load flashes (channel width, hero blink, white page) ([#59](https://github.com/sigman78/dspi-web-console/issues/59)) ([141f3d0](https://github.com/sigman78/dspi-web-console/commit/141f3d035d60b40cc6ac6698bea4bf8fc61be9d7))


### Performance Improvements

* **autoeq:** keep DB entries out of deep reactive state ([38c85a9](https://github.com/sigman78/dspi-web-console/commit/38c85a9f47f2a29677c92b2a2000a90d1f32c758))

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

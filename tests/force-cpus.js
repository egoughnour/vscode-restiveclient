const os = require('os');

const fakeCpuInfo = {
    model: 'stubbed',
    speed: 0,
    times: {
        user: 0,
        nice: 0,
        sys: 0,
        idle: 0,
        irq: 0,
    },
};

os.cpus = () => [fakeCpuInfo];

if (typeof os.availableParallelism === 'function') {
    os.availableParallelism = () => 1;
}

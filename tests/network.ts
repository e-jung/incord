/** Valid unique IPv6 /64s isolate disposable local clients without bypassing IP parsing. */
export function testIp(){const hex=crypto.randomUUID().replaceAll('-','');return `fd${hex.slice(0,2)}:${hex.slice(2,6)}:${hex.slice(6,10)}:${hex.slice(10,14)}::1`}

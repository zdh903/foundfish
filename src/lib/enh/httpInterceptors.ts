/**
 * FoundFish does not inherit the upstream private request interception layer.
 *
 * Request policy is intentionally kept in the public source tree.  Individual
 * data providers are called by the service adapter and no bypass or provider
 * specific evasion logic is used here.
 */
const interceptors: [] = [];

export default interceptors;

import './ui/styles.css';
import { startApp } from './ui/app';
import { byId } from './ui/dom';
import { registerServiceWorker, watchConnectivity } from './ui/sw-register';

// batch_size comes from Remote Config once the AI layer is wired; 4 is the in-app default.
startApp({ batchSize: 4 });
watchConnectivity(byId('net-status'));
registerServiceWorker(byId('offline-status'));

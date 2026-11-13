import {mount} from 'svelte';
import './fonts.css';
import './tokens.css';
import './app.css';
import App from './App.svelte';
mount(App,{target:document.getElementById('app')!});
if('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js');

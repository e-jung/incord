<script lang="ts">
import {ui} from '../config/ui';
let {days=[]}:{days?:string[]}=$props();let now=new Date();let monday=new Date(now);monday.setDate(now.getDate()-((now.getDay()+6)%7));</script><ol class="week-dots" aria-label={ui.c213}>{#each [ui.c214,ui.c215,ui.c216,ui.c215,ui.c217,ui.c218,ui.c218] as day,i}{@const date=new Date(monday.getFullYear(),monday.getMonth(),monday.getDate()+i).toLocaleDateString(ui.c219)}<li class:done={days.includes(date)} class:today={i===(now.getDay()+6)%7}>{day}</li>{/each}</ol>

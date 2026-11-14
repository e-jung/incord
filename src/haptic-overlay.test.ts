import {describe,it,expect,vi,afterEach} from 'vitest';
import {hapticOverlay,usesHapticOverlay} from './haptic-overlay';
const ios={userAgent:'iPhone OS 26_5',platform:'iPhone',maxTouchPoints:5} as Navigator;
describe('trusted-tap overlay eligibility',()=>{
 it('requires enabled haptics and iOS with no vibration API',()=>{
  expect(usesHapticOverlay({},ios)).toBe(false);
  expect(usesHapticOverlay({haptics:false},ios)).toBe(false);
  expect(usesHapticOverlay({haptics:true},ios)).toBe(true);
  expect(usesHapticOverlay({haptics:true},{...ios,vibrate:()=>true} as Navigator)).toBe(false);
 });
 it('supports touch-capable iPad desktop identity, not ordinary Macs or Android',()=>{
  expect(usesHapticOverlay({haptics:true},{userAgent:'Macintosh',platform:'MacIntel',maxTouchPoints:5} as Navigator)).toBe(true);
  expect(usesHapticOverlay({haptics:true},{userAgent:'Macintosh',platform:'MacIntel',maxTouchPoints:0} as Navigator)).toBe(false);
  expect(usesHapticOverlay({haptics:true},{userAgent:'Android',platform:'Linux',maxTouchPoints:5} as Navigator)).toBe(false);
  expect(usesHapticOverlay({haptics:true},undefined)).toBe(false);
 });
});

// A small DOM boundary double keeps lifecycle tests independent of a browser.
class ElementDouble extends EventTarget {
  children: ElementDouble[] = [];
  parentNode: ElementDouble | null = null;
  className = '';
  attributes = new Map<string,string>();
  disabled = false;
  tabIndex = 0;
  type = '';
  isConnected = true;
  get classList() {
    return {
      contains: (name:string) => this.className.split(' ').includes(name),
      add: (name:string) => { if (!this.className.split(' ').includes(name)) this.className += ` ${name}`; },
      remove: (name:string) => { this.className = this.className.split(' ').filter(value=>value!==name).join(' '); }
    };
  }
  setAttribute(name:string,value:string) { this.attributes.set(name,value); }
  append(child:ElementDouble) { child.remove(); this.children.push(child); child.parentNode=this; }
  before(child:ElementDouble) { const parent=this.parentNode!; child.remove(); parent.children.splice(parent.children.indexOf(this),0,child); child.parentNode=parent; }
  replaceWith(child:ElementDouble) { this.before(child); this.remove(); }
  remove() { if(this.parentNode) this.parentNode.children.splice(this.parentNode.children.indexOf(this),1); this.parentNode=null; }
  focus = vi.fn(() => { Object.defineProperty(document,'activeElement',{value:this,configurable:true}); });
}
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers()});
function setup() {
  vi.useFakeTimers();
  const parent=new ElementDouble(),button=new ElementDouble(),region=new ElementDouble(),body=new ElementDouble();
  button.className='key'; parent.append(button);
  vi.stubGlobal('HTMLElement',ElementDouble);
  vi.stubGlobal('navigator',ios);
  vi.stubGlobal('document',{activeElement:region,body,createElement:()=>new ElementDouble()});
  const onpress=vi.fn();
  const action=hapticOverlay(button as unknown as HTMLButtonElement,{enabled:true,onpress});
  return {parent,button,region,body,onpress,action,input:parent.children[0].children[1]};
}
describe('sibling overlay lifecycle',()=>{
 it('wraps the original button with a sibling native switch and unwraps on disable/destroy',()=>{
  const {parent,button,input,action}=setup();
  expect(parent.children[0].classList.contains('haptic-key')).toBe(true);
  expect(parent.children[0].children).toEqual([button,input]);
  expect(button.children).toEqual([]);
  expect(input.type).toBe('checkbox');expect(input.attributes.get('switch')).toBe('');
  expect(input.attributes.get('aria-hidden')).toBe('true');expect(input.tabIndex).toBe(-1);
  action.update({enabled:false,onpress:vi.fn()});expect(parent.children).toEqual([button]);
  action.update({enabled:true,onpress:vi.fn()});expect(parent.children[0].children[0]).toBe(button);
  action.destroy();expect(parent.children).toEqual([button]);action.destroy();
 });
 it('dispatches once without canceling native click and restores prior focus with a 150ms press',()=>{
  const {button,input,region,onpress,action}=setup();
  input.dispatchEvent(new Event('pointerdown'));input.focus();
  const click=new Event('click',{cancelable:true,bubbles:true});
  expect(input.dispatchEvent(click)).toBe(true);expect(click.defaultPrevented).toBe(false);
  expect(onpress).toHaveBeenCalledTimes(1);expect(region.focus).toHaveBeenCalledWith({preventScroll:true});
  expect(button.classList.contains('haptic-pressed')).toBe(true);
  vi.advanceTimersByTime(149);expect(button.classList.contains('haptic-pressed')).toBe(true);
  vi.advanceTimersByTime(1);expect(button.classList.contains('haptic-pressed')).toBe(false);
  action.destroy();input.dispatchEvent(new Event('click'));expect(onpress).toHaveBeenCalledTimes(1);
 });
 it('uses updated callbacks, ignores disabled controls and preserves intentional focus changes',()=>{
  const {button,input,region,action}=setup();const next=new ElementDouble();
  const onpress=vi.fn(()=>next.focus());action.update({enabled:true,onpress});
  input.dispatchEvent(new Event('pointerdown'));input.focus();input.dispatchEvent(new Event('click'));
  expect(onpress).toHaveBeenCalledTimes(1);expect(region.focus).not.toHaveBeenCalled();expect(document.activeElement).toBe(next);
  button.disabled=true;action.update({enabled:true,onpress});expect(input.disabled).toBe(true);
  input.dispatchEvent(new Event('click'));expect(onpress).toHaveBeenCalledTimes(1);
  action.destroy();expect(vi.getTimerCount()).toBe(0);
 });
});

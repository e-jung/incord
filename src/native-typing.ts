/** One first-letter answer per input event, including paste/composition commits. */
export function practiceCharacter(value:string):string|undefined {
  return value.match(/[a-z0-9]/i)?.[0].toLowerCase();
}

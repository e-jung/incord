/** Content lookup and persistence messages; wording can change without engine edits. */
export const contentCopy={
 offline:'This Bible book is not available offline yet. Connect once to download it.',
 translation:'Choose BSB, KJV, or WEB.',
 reference:'Enter a reference such as Romans 8:28-30 or Psalm 23.',
 book:'That Bible book was not recognized.',
 range:'The end of the passage must follow its beginning.',
 chapter:'That chapter does not exist in this book.',
 verse:(translation:string)=>`That verse is not present in ${translation}. Check the reference or translation.`,
 empty:'No verses found for that reference.',
 retry:'Please try again.'
} as const;

// modules/judgevoices/judgevoices.js — v879
// Static MP3 judge lines (score dialogue + 876/878 packs).
// Free-tier premade voices: Adam / Antoni / Arnold / George / Daniel / Harry (male Freddie)
(function(){
  'use strict';

  var VOICES = {
    bengine:  { id:'pNInz6obpgDQGcFmaJgB', name:'Adam' },
    artie:    { id:'ErXwobaYiN019PkySvjV', name:'Antoni' },
    howie:    { id:'VR6AewLTigWG4xSOukaG', name:'Arnold' },
    billie:   { id:'JBFqnCBsd6RMkjVDRZzb', name:'George' },
    jackie:   { id:'onwK4e9ZLuTAKqWW03F9', name:'Daniel' },
    freddie:  { id:'SOYHLrjzK2X1ezoPC6cr', name:'Harry' }
  };

  var LINES = {
    bengine:[
      {id:'bengine_876_01', text:"Pitch deviation: zero. Soul deviation: also zero.", audio:'bengine_876_01.mp3'},
      {id:'bengine_876_02', text:"Recalculating your credibility... please stand by.", audio:'bengine_876_02.mp3'},
      {id:'bengine_876_03', text:"That bend registered as a rounding error, not an emotion.", audio:'bengine_876_03.mp3'},
      {id:'bengine_876_04', text:"Scale compliance: 98.7%. Rhythm compliance: does not compute.", audio:'bengine_876_04.mp3'},
      {id:'bengine_876_05', text:"Your vibrato has been logged and filed under \"attempts.\"", audio:'bengine_876_05.mp3'},
      {id:'bengine_876_06', text:"Warning: excessive confidence detected in a two-note lick.", audio:'bengine_876_06.mp3'},
      {id:'bengine_876_07', text:"Timing drifted 40 milliseconds. I felt every one of them.", audio:'bengine_876_07.mp3'},
      {id:'bengine_876_08', text:"Processing... processing... still processing why you chose that note.", audio:'bengine_876_08.mp3'},
      {id:'bengine_876_09', text:"Greatness requires more than pressing frets. Correction: it requires exactly that, done better.", audio:'bengine_876_09.mp3'},
      {id:'bengine_876_10', text:"Error 404: groove not found.", audio:'bengine_876_10.mp3'},
      {id:'bengine_878_01', text:"Analysis complete. Result: technically correct, spiritually vacant.", audio:'bengine_878_01.mp3'},
      {id:'bengine_878_02', text:"I have modeled 14,000 better resolutions for that phrase.", audio:'bengine_878_02.mp3'},
      {id:'bengine_878_03', text:"Your dynamics register as a flat line. That is not a compliment.", audio:'bengine_878_03.mp3'},
      {id:'bengine_878_04', text:"Note chosen. Intent missing. File under incomplete data.", audio:'bengine_878_04.mp3'},
      {id:'bengine_878_05', text:"I detected swing. I also detected hesitation. They canceled out.", audio:'bengine_878_05.mp3'},
      {id:'bengine_878_06', text:"Confidence interval on that lick: 12 percent. Proceed with caution.", audio:'bengine_878_06.mp3'},
      {id:'bengine_878_07', text:"The metronome did not consent to what you just did.", audio:'bengine_878_07.mp3'},
      {id:'bengine_878_08', text:"Quantize yourself. The grid is disappointed.", audio:'bengine_878_08.mp3'},
      {id:'bengine_878_09', text:"That was a scale. A scale is not a solo. Updating criteria.", audio:'bengine_878_09.mp3'},
      {id:'bengine_878_10', text:"System recommendation: fewer notes, more meaning.", audio:'bengine_878_10.mp3'}
    ],
    artie:[
      {id:'artie_876_01', text:"Eh, you play like a man who has never been in love. Try again, but mean it this time.", audio:'artie_876_01.mp3'},
      {id:'artie_876_02', text:"That bend — bellissimo. The rest — eh, we don't talk about the rest.", audio:'artie_876_02.mp3'},
      {id:'artie_876_03', text:"You rush the phrase like you got somewhere better to be. Nobody's better, kid. Sit in it.", audio:'artie_876_03.mp3'},
      {id:'artie_876_04', text:"My nonna played more soul on a broken mandolin.", audio:'artie_876_04.mp3'},
      {id:'artie_876_05', text:"You found the blue note. Good. Now find out why it's blue.", audio:'artie_876_05.mp3'},
      {id:'artie_876_06', text:"Slow down. Even a bullet takes its time to leave the chamber.", audio:'artie_876_06.mp3'},
      {id:'artie_876_07', text:"That was tasteful. I didn't think you had it in you.", audio:'artie_876_07.mp3'},
      {id:'artie_876_08', text:"You play the notes like you're paying rent on them. Own the place.", audio:'artie_876_08.mp3'},
      {id:'artie_876_09', text:"Ah, the pentatonic. Reliable. Like a cousin who always shows up, never surprises.", audio:'artie_876_09.mp3'},
      {id:'artie_876_10', text:"One more take like that and I buy you dinner. One more like the last one, I'm leaving town.", audio:'artie_876_10.mp3'},
      {id:'artie_878_01', text:"You left space. Space is where the music breathes. Don't fill it with panic.", audio:'artie_878_01.mp3'},
      {id:'artie_878_02', text:"That phrase had a beginning. It needs an ending that isn't a shrug.", audio:'artie_878_02.mp3'},
      {id:'artie_878_03', text:"Play to the back of the room, not the top of the neck.", audio:'artie_878_03.mp3'},
      {id:'artie_878_04', text:"I heard the idea. Then you got scared of it. Go back.", audio:'artie_878_04.mp3'},
      {id:'artie_878_05', text:"Soft hands, hard choices. You had it backwards.", audio:'artie_878_05.mp3'},
      {id:'artie_878_06', text:"The chord was already crying. You didn't have to yell over it.", audio:'artie_878_06.mp3'},
      {id:'artie_878_07', text:"Nice tone. Now say something with it.", audio:'artie_878_07.mp3'},
      {id:'artie_878_08', text:"You resolved early. Tension is a gift — open it slower.", audio:'artie_878_08.mp3'},
      {id:'artie_878_09', text:"That lick walked in wearing a tuxedo and left in socks. Commit.", audio:'artie_878_09.mp3'},
      {id:'artie_878_10', text:"Bravissimo for the try. Next time, bravissimo for the truth.", audio:'artie_878_10.mp3'},
      // scoring.js grade lines (partial pack — MP3s generated)
      {id:'artie_score_hi_01', text:'Loose and lovely, baby.', audio:'artie_score_hi_01.mp3'},
      {id:'artie_score_hi_02', text:'Felt good — who counts clams?', audio:'artie_score_hi_02.mp3'},
      {id:'artie_score_hi_03', text:'You let it breathe. I dig it.', audio:'artie_score_hi_03.mp3'},
      {id:'artie_score_hi_04', text:"Smooth. You weren't even trying hard.", audio:'artie_score_hi_04.mp3'},
      {id:'artie_score_hi_05', text:"That's the good stuff. Effortless.", audio:'artie_score_hi_05.mp3'},
      {id:'artie_score_hi_06', text:'Rode the groove like a hammock.', audio:'artie_score_hi_06.mp3'},
      {id:'artie_score_hi_07', text:'Yeah man, that just flowed.', audio:'artie_score_hi_07.mp3'},
      {id:'artie_score_hi_08', text:'Butter. Pure butter.', audio:'artie_score_hi_08.mp3'},
      {id:'artie_score_hi_09', text:'You and the beat were old friends.', audio:'artie_score_hi_09.mp3'},
      {id:'artie_score_hi_10', text:"Didn't think, just played. Perfect.", audio:'artie_score_hi_10.mp3'},
      {id:'artie_score_hi_11', text:'That had a Sunday-morning glow.', audio:'artie_score_hi_11.mp3'},
      {id:'artie_score_hi_12', text:'Butter on toast, that was.', audio:'artie_score_hi_12.mp3'},
      {id:'artie_score_hi_13', text:'You made the guitar sing, kid.', audio:'artie_score_hi_13.mp3'},
      {id:'artie_score_hi_14', text:'Like a good espresso, strong and smooth.', audio:'artie_score_hi_14.mp3'},
      {id:'artie_score_hi_15', text:'You got that lounge-singer swagger tonight.', audio:'artie_score_hi_15.mp3'},
      {id:'artie_score_hi_16', text:'That phrasing had real Napoli in it.', audio:'artie_score_hi_16.mp3'},
      {id:'artie_score_hi_17', text:'You told a story up there, kid.', audio:'artie_score_hi_17.mp3'},
      {id:'artie_score_hi_18', text:'That was a warm night in Napoli, right there.', audio:'artie_score_hi_18.mp3'},
      {id:'artie_score_hi_19', text:'You danced with the changes, kid.', audio:'artie_score_hi_19.mp3'},
      {id:'artie_score_hi_20', text:'That had real gravel and honey in it.', audio:'artie_score_hi_20.mp3'},
      {id:'artie_score_hi_21', text:'You made an old song feel brand new, kid.', audio:'artie_score_hi_21.mp3'},
      {id:'artie_score_mid_01', text:'Rough, but it had heart.', audio:'artie_score_mid_01.mp3'},
      {id:'artie_score_mid_02', text:"I'll allow it. Vibes carried you.", audio:'artie_score_mid_02.mp3'},
      {id:'artie_score_mid_03', text:'Not clean, not boring either.', audio:'artie_score_mid_03.mp3'},
      {id:'artie_score_mid_04', text:'Few bumps, still felt nice.', audio:'artie_score_mid_04.mp3'},
      {id:'artie_score_mid_05', text:"Loosen up more, it'll come.", audio:'artie_score_mid_05.mp3'},
      {id:'artie_score_mid_06', text:'Decent hang. No complaints here.', audio:'artie_score_mid_06.mp3'},
      {id:'artie_score_mid_07', text:'Almost in the pocket. Almost.', audio:'artie_score_mid_07.mp3'},
      {id:'artie_score_mid_08', text:'You were thinking too hard, man.', audio:'artie_score_mid_08.mp3'},
      {id:'artie_score_mid_09', text:'Stop counting, start feeling.', audio:'artie_score_mid_09.mp3'},
      {id:'artie_score_mid_10', text:'It wandered, but pleasantly.', audio:'artie_score_mid_10.mp3'},
      {id:'artie_score_mid_11', text:'Halfway to a hammock.', audio:'artie_score_mid_11.mp3'},
      {id:'artie_score_mid_12', text:'Bit rough round the edges, but it had soul.', audio:'artie_score_mid_12.mp3'},
      {id:'artie_score_mid_13', text:'Not bad, not bad - a little more swagger.', audio:'artie_score_mid_13.mp3'},
      {id:'artie_score_mid_14', text:"It's a Tuesday night set. Nothing wrong with that.", audio:'artie_score_mid_14.mp3'},
      {id:'artie_score_mid_15', text:"Solid. Wouldn't turn my back on it.", audio:'artie_score_mid_15.mp3'},
      {id:'artie_score_mid_16', text:'Decent plate of pasta, not the best I have had.', audio:'artie_score_mid_16.mp3'},
      {id:'artie_score_mid_17', text:'You played it safe. Safe is fine, tonight.', audio:'artie_score_mid_17.mp3'},
      {id:'artie_score_mid_18', text:'Not bad. Not the special, but not bad.', audio:'artie_score_mid_18.mp3'},
      {id:'artie_score_mid_19', text:'A little cold in the middle, warm at the end.', audio:'artie_score_mid_19.mp3'},
      {id:'artie_score_mid_20', text:"It's a working man's set. Gets the job done.", audio:'artie_score_mid_20.mp3'},
      {id:'artie_score_mid_21', text:'Steady hands, could use a little fire.', audio:'artie_score_mid_21.mp3'},
      {id:'artie_score_lo_01', text:'Still a spark in there somewhere.', audio:'artie_score_lo_01.mp3'},
      {id:'artie_score_lo_02', text:'Messy, but you went for it. Respect.', audio:'artie_score_lo_02.mp3'},
      {id:'artie_score_lo_03', text:'Heard worse on a good night.', audio:'artie_score_lo_03.mp3'},
      {id:'artie_score_lo_04', text:'Take a breath, try it sleepy.', audio:'artie_score_lo_04.mp3'},
      {id:'artie_score_lo_05', text:'No worries. Shake it off.', audio:'artie_score_lo_05.mp3'},
      {id:'artie_score_lo_06', text:"Rough one, but I'm not mad.", audio:'artie_score_lo_06.mp3'},
      {id:'artie_score_lo_07', text:"Eh, we've all had off takes.", audio:'artie_score_lo_07.mp3'},
      {id:'artie_score_lo_08', text:'You were tense. I could hear it.', audio:'artie_score_lo_08.mp3'},
      {id:'artie_score_lo_09', text:'Let it go, then play it again.', audio:'artie_score_lo_09.mp3'},
      {id:'artie_score_lo_10', text:"Forgiven. Music's hard, baby.", audio:'artie_score_lo_10.mp3'},
      {id:'artie_score_lo_11', text:'Eh, we all have off nights, cugino.', audio:'artie_score_lo_11.mp3'},
      {id:'artie_score_lo_12', text:'The heart was there, the hands were somewhere else.', audio:'artie_score_lo_12.mp3'},
      {id:'artie_score_lo_13', text:'Even Sinatra had a rough Tuesday, kid.', audio:'artie_score_lo_13.mp3'},
      {id:'artie_score_lo_14', text:"Hey, the bar's still open. Try again.", audio:'artie_score_lo_14.mp3'},
      {id:'artie_score_lo_15', text:"Eh, the sauce didn't come together.", audio:'artie_score_lo_15.mp3'},
      {id:'artie_score_lo_16', text:'We start again tomorrow, no shame in it.', audio:'artie_score_lo_16.mp3'},
      {id:'artie_score_lo_17', text:'Even the espresso machine broke that night.', audio:'artie_score_lo_17.mp3'},
      {id:'artie_score_lo_18', text:'We forgive it. Come back Thursday.', audio:'artie_score_lo_18.mp3'},
      {id:'artie_score_lo_19', text:'Even the best kitchen burns a dish sometimes.', audio:'artie_score_lo_19.mp3'},
      {id:'artie_score_lo_20', text:'Shake it off, the next one is yours.', audio:'artie_score_lo_20.mp3'}
    ],
    howie:[
      {id:'howie_876_01', text:"THAT'S what I'm talking about! Do it again before I change my mind!", audio:'howie_876_01.mp3'},
      {id:'howie_876_02', text:"You call that a bend? My grandmother bends harder opening a jar!", audio:'howie_876_02.mp3'},
      {id:'howie_876_03', text:"Own that fretboard! It works for you, not the other way around!", audio:'howie_876_03.mp3'},
      {id:'howie_876_04', text:"I don't want good. I want undeniable. Give me undeniable!", audio:'howie_876_04.mp3'},
      {id:'howie_876_05', text:"You flinched on that high string. Judges see everything. EVERYTHING.", audio:'howie_876_05.mp3'},
      {id:'howie_876_06', text:"Louder isn't better, but that was both, so — fine, I'll allow it!", audio:'howie_876_06.mp3'},
      {id:'howie_876_07', text:"You buried the lead! That lick should've been the whole solo!", audio:'howie_876_07.mp3'},
      {id:'howie_876_08', text:"Quit apologizing with your playing. Commit to the note!", audio:'howie_876_08.mp3'},
      {id:'howie_876_09', text:"That's a six. Not because it was bad — because I know you've got a nine in you!", audio:'howie_876_09.mp3'},
      {id:'howie_876_10', text:"Stop thinking! I can hear you thinking! Play, don't calculate!", audio:'howie_876_10.mp3'},
      {id:'howie_878_01', text:"Hit it like you mean rent! Not like you're borrowing the guitar!", audio:'howie_878_01.mp3'},
      {id:'howie_878_02', text:"I want fire! That was a wet match! Light it!", audio:'howie_878_02.mp3'},
      {id:'howie_878_03', text:"Don't peek at the fretboard like it owes you an apology!", audio:'howie_878_03.mp3'},
      {id:'howie_878_04', text:"Bigger! Not louder — bigger! There's a difference!", audio:'howie_878_04.mp3'},
      {id:'howie_878_05', text:"You had the audience! Then you gave them back! Take them!", audio:'howie_878_05.mp3'},
      {id:'howie_878_06', text:"That was almost great! Almost doesn't fill arenas!", audio:'howie_878_06.mp3'},
      {id:'howie_878_07', text:"Plant your feet! Your notes are wandering off the stage!", audio:'howie_878_07.mp3'},
      {id:'howie_878_08', text:"I believed you for three bars! Make it eight!", audio:'howie_878_08.mp3'},
      {id:'howie_878_09', text:"Sweat on the frets! Not sweat from fear — sweat from work!", audio:'howie_878_09.mp3'},
      {id:'howie_878_10', text:"Again! And this time, don't leave any notes on the table!", audio:'howie_878_10.mp3'}
    ],
    billie:[
      {id:'billie_876_01', text:"BOING! That note just bounced off my eardrum and did a backflip!", audio:'billie_876_01.mp3'},
      {id:'billie_876_02', text:"I closed my eyes and saw a cartoon raccoon play that solo better. Wake up!", audio:'billie_876_02.mp3'},
      {id:'billie_876_03', text:"OoOOoo, spicy note! Somebody call the flavor police!", audio:'billie_876_03.mp3'},
      {id:'billie_876_04', text:"That lick had the energy of a toaster falling down the stairs. Good energy? Unclear!", audio:'billie_876_04.mp3'},
      {id:'billie_876_05', text:"Plot twist! Didn't see that chromatic run coming! Neither did you, probably!", audio:'billie_876_05.mp3'},
      {id:'billie_876_06', text:"Ding ding ding! Feed this player a kazoo as a reward!", audio:'billie_876_06.mp3'},
      {id:'billie_876_07', text:"That was so smooth I slid right off my chair. Send help. Also send more.", audio:'billie_876_07.mp3'},
      {id:'billie_876_08', text:"Your rhythm cartwheeled into the wrong bar and stuck the landing anyway!", audio:'billie_876_08.mp3'},
      {id:'billie_876_09', text:"I don't know what scale that was but it tasted purple!", audio:'billie_876_09.mp3'},
      {id:'billie_876_10', text:"HONK! That was the sound of my expectations leaving the building!", audio:'billie_876_10.mp3'},
      {id:'billie_878_01', text:"WHOOSH! That phrase just ran past me wearing roller skates!", audio:'billie_878_01.mp3'},
      {id:'billie_878_02', text:"I award you one imaginary trophy shaped like a confused duck!", audio:'billie_878_02.mp3'},
      {id:'billie_878_03', text:"That bend went to space and forgot to bring oxygen!", audio:'billie_878_03.mp3'},
      {id:'billie_878_04', text:"My left ear just high-fived my right ear. They're confused but supportive!", audio:'billie_878_04.mp3'},
      {id:'billie_878_05', text:"You played a secret door into a clown dimension. I live there now!", audio:'billie_878_05.mp3'},
      {id:'billie_878_06', text:"Sproing! Notes bouncing like popcorn with opinions!", audio:'billie_878_06.mp3'},
      {id:'billie_878_07', text:"That was either genius or a glitch in the matrix. I'm voting both!", audio:'billie_878_07.mp3'},
      {id:'billie_878_08', text:"Please warn me before you drop a lick that loud in my brain!", audio:'billie_878_08.mp3'},
      {id:'billie_878_09', text:"I just invented a new emoji for what you did. It has three eyebrows!", audio:'billie_878_09.mp3'},
      {id:'billie_878_10', text:"Encore for the chaos! Encore for the chaos! ...Okay one more chaos!", audio:'billie_878_10.mp3'},
      // scoring.js grade lines (partial pack — MP3s generated)
      {id:'billie_score_hi_01', text:'YES. Burn it down!', audio:'billie_score_hi_01.mp3'},
      {id:'billie_score_hi_02', text:"Unhinged. I'm obsessed.", audio:'billie_score_hi_02.mp3'},
      {id:'billie_score_hi_03', text:'That bend nearly took my head off.', audio:'billie_score_hi_03.mp3'},
      {id:'billie_score_hi_04', text:'Reckless and PERFECT.', audio:'billie_score_hi_04.mp3'},
      {id:'billie_score_hi_05', text:'You scared me. Do it again.', audio:'billie_score_hi_05.mp3'},
      {id:'billie_score_hi_06', text:'Pure adrenaline. More!', audio:'billie_score_hi_06.mp3'},
      {id:'billie_score_hi_07', text:'I felt that in my teeth.', audio:'billie_score_hi_07.mp3'},
      {id:'billie_score_hi_08', text:'FERAL. Absolutely feral. Love it.', audio:'billie_score_hi_08.mp3'},
      {id:'billie_score_hi_09', text:'You played like the amp owed you money.', audio:'billie_score_hi_09.mp3'},
      {id:'billie_score_hi_10', text:'That solo had a body count.', audio:'billie_score_hi_10.mp3'},
      {id:'billie_score_hi_11', text:'Loud, wrong, GLORIOUS.', audio:'billie_score_hi_11.mp3'},
      {id:'billie_score_mid_06', text:'Push HARDER next time.', audio:'billie_score_mid_06.mp3'},
      {id:'billie_score_mid_07', text:'Almost dangerous. Almost.', audio:'billie_score_mid_07.mp3'},
      {id:'billie_score_mid_08', text:"You apologised with that note. Don't.", audio:'billie_score_mid_08.mp3'},
      {id:'billie_score_mid_09', text:'Some fire. I wanted an inferno.', audio:'billie_score_mid_09.mp3'},
      {id:'billie_score_mid_10', text:'Good. Now break the rules harder.', audio:'billie_score_mid_10.mp3'},
      {id:'billie_score_mid_11', text:'You flinched. I saw it.', audio:'billie_score_mid_11.mp3'},
      {id:'billie_score_mid_12', text:'Eh, needs more EXPLOSIONS, but okay okay.', audio:'billie_score_mid_12.mp3'},
      {id:'billie_score_mid_13', text:'I almost fell off my chair. ALMOST.', audio:'billie_score_mid_13.mp3'},
      {id:'billie_score_mid_14', text:'Meh-diocre! Get it? Meh? ...Eh.', audio:'billie_score_mid_14.mp3'},
      {id:'billie_score_mid_15', text:'A solid maybe-kinda-good-ish job!', audio:'billie_score_mid_15.mp3'}
    ],
    jackie:[
      {id:'jackie_876_01', text:"Was that a bend or are you just squeezing the neck for emotional support?", audio:'jackie_876_01.mp3'},
      {id:'jackie_876_02', text:"Nice pentatonic! Very safe! Very beige! Very... fine, I guess!", audio:'jackie_876_02.mp3'},
      {id:'jackie_876_03', text:"You hit the root note like it owed you money!", audio:'jackie_876_03.mp3'},
      {id:'jackie_876_04', text:"I give that solo a solid \"my dad plays golf\" energy.", audio:'jackie_876_04.mp3'},
      {id:'jackie_876_05', text:"That timing was so loose I could drive a truck through the gaps!", audio:'jackie_876_05.mp3'},
      {id:'jackie_876_06', text:"Did that lick apologize on its way out? Because it should have!", audio:'jackie_876_06.mp3'},
      {id:'jackie_876_07', text:"Careful — one more clean run and people might call you talented!", audio:'jackie_876_07.mp3'},
      {id:'jackie_876_08', text:"You call that vibrato? My phone on silent shakes harder!", audio:'jackie_876_08.mp3'},
      {id:'jackie_876_09', text:"That note choice was bold. Socks-with-sandals bold.", audio:'jackie_876_09.mp3'},
      {id:'jackie_876_10', text:"Ten for confidence, three for accuracy, solid seven for comedy!", audio:'jackie_876_10.mp3'},
      {id:'jackie_878_01', text:"Oh good, another scale run. The world was short on those.", audio:'jackie_878_01.mp3'},
      {id:'jackie_878_02', text:"You played it safe so hard it became dangerous — to my patience.", audio:'jackie_878_02.mp3'},
      {id:'jackie_878_03', text:"If bland were a sport, you'd be drafting first round.", audio:'jackie_878_03.mp3'},
      {id:'jackie_878_04', text:"That ending didn't land. It politely declined to arrive.", audio:'jackie_878_04.mp3'},
      {id:'jackie_878_05', text:"I've heard elevator music with more narrative arc.", audio:'jackie_878_05.mp3'},
      {id:'jackie_878_06', text:"Bold of you to assume that was a climax.", audio:'jackie_878_06.mp3'},
      {id:'jackie_878_07', text:"The crowd is polite. I am not the crowd.", audio:'jackie_878_07.mp3'},
      {id:'jackie_878_08', text:"You almost surprised me. Almost is where dreams go to nap.", audio:'jackie_878_08.mp3'},
      {id:'jackie_878_09', text:"Save some mediocrity for the rest of the set.", audio:'jackie_878_09.mp3'},
      {id:'jackie_878_10', text:"I'll clap when my hands stop being sarcastic.", audio:'jackie_878_10.mp3'}
    ],
    freddie:[
      {id:'freddie_876_01', text:"That was a note. It happened. I acknowledge it.", audio:'freddie_876_01.mp3'},
      {id:'freddie_876_02', text:"Adequate. I have withheld further comment.", audio:'freddie_876_02.mp3'},
      {id:'freddie_876_03', text:"The scale was correct. My enthusiasm was not required, and was not present.", audio:'freddie_876_03.mp3'},
      {id:'freddie_876_04', text:"I felt something during that bend. I choose not to elaborate.", audio:'freddie_876_04.mp3'},
      {id:'freddie_876_05', text:"You played. Time passed. Both occurred simultaneously.", audio:'freddie_876_05.mp3'},
      {id:'freddie_876_06', text:"That was fine. \"Fine\" is the ceiling of this sentence.", audio:'freddie_876_06.mp3'},
      {id:'freddie_876_07', text:"I have seen better. I have also seen worse. This was between them.", audio:'freddie_876_07.mp3'},
      {id:'freddie_876_08', text:"Noted. Filed. Moving on.", audio:'freddie_876_08.mp3'},
      {id:'freddie_876_09', text:"There was a solo. I was present for it.", audio:'freddie_876_09.mp3'},
      {id:'freddie_876_10', text:"I will not clap. But I did consider it, briefly, and then did not.", audio:'freddie_876_10.mp3'},
      {id:'freddie_878_01', text:"I have formed an opinion. I am keeping it.", audio:'freddie_878_01.mp3'},
      {id:'freddie_878_02', text:"The notes were present. So was I. That is the review.", audio:'freddie_878_02.mp3'},
      {id:'freddie_878_03', text:"Acceptable within a narrow definition of acceptable.", audio:'freddie_878_03.mp3'},
      {id:'freddie_878_04', text:"I neither endorse nor oppose what just occurred.", audio:'freddie_878_04.mp3'},
      {id:'freddie_878_05', text:"If silence were a score, we would be having a different conversation.", audio:'freddie_878_05.mp3'},
      {id:'freddie_878_06', text:"My notes on your notes are blank. Interpret that as you wish.", audio:'freddie_878_06.mp3'},
      {id:'freddie_878_07', text:"You finished. I noticed. Continuity is valued.", audio:'freddie_878_07.mp3'},
      {id:'freddie_878_08', text:"There are adjectives for that. I am not using them.", audio:'freddie_878_08.mp3'},
      {id:'freddie_878_09', text:"I remain unmoved. That is not an insult. It is data.", audio:'freddie_878_09.mp3'},
      {id:'freddie_878_10', text:"End of statement. Further praise requires further evidence.", audio:'freddie_878_10.mp3'}
    ]
  };

  function audioFor(judgeId, lineId){
    var arr = LINES[judgeId]; if(!arr) return null;
    for(var i=0;i<arr.length;i++){
      if(arr[i].id===lineId && arr[i].audio) return 'audio/'+judgeId+'/'+arr[i].audio;
    }
    return null;
  }

  function speak(judgeId, lineId, text, opts){
    opts = opts || {};
    var rel = audioFor(judgeId, lineId);
    if(!rel && text){
      var arr = LINES[judgeId];
      if(arr){
        var tn = String(text).replace(/\s+/g,' ').trim().toLowerCase();
        for(var i=0;i<arr.length;i++){
          if(!arr[i].audio) continue;
          if(arr[i].text===text){ rel='audio/'+judgeId+'/'+arr[i].audio; break; }
          var ct = String(arr[i].text||'').replace(/\s+/g,' ').trim().toLowerCase();
          if(ct && (tn===ct || tn.indexOf(ct)===0)){ rel='audio/'+judgeId+'/'+arr[i].audio; break; }
        }
      }
    }
    if(rel){
      try{
        var root = (window.__rootRelative ? window.__rootRelative('modules/judgevoices/'+rel) : ('modules/judgevoices/'+rel));
        var a = new Audio(root);
        a.play().catch(function(){
          if(opts.allowMeSpeak && window.meSpeak) try{ window.meSpeak.speak(text||'', opts); }catch(e){}
        });
        return;
      }catch(e){}
    }
    if(opts.allowMeSpeak && window.meSpeak && text){
      try{ window.meSpeak.speak(text, opts); }catch(e){}
    }
  }

  function getLines(judgeId){ return (LINES[judgeId]||[]).slice(); }
  function getVoice(judgeId){ return VOICES[judgeId]||null; }

  window.registerModule('judgevoices', {
    version:'4.9.8.879',
    isStub:false,
    VOICES:VOICES,
    LINES:LINES,
    speak:speak,
    getLines:getLines,
    getVoice:getVoice
  });
})();

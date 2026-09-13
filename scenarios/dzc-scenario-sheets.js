/* Score sheets written out by hand for all sixteen Dropzone scenarios, as the Dropfleet pages do
   (scenarios/dropfleet/scenario-sheets.js there). Each follows its scenario's objective lines and the
   rulebook's 9.6 Scenario Objectives, with the game size and the Variant that is on:

     DZ_SHEETS[id]({size, v}) -> rows

   size is 'skirmish' | 'clash' | 'battle' | 'reconquest'; v is '0', '1' or '2'.
   Rows (shared/score.js): {heading, sub, rounds} starts a group, rounds being the Rounds it scores
   on (a game ends after Round 6, 9.3); {text, parts:[{kind:'count'|'check', vp, label}]} is a line.
   9.5: points and KP requirements are halved in a Skirmish, so their labels say so. */
(function(){
  const H=(heading,sub='',rounds=[])=>({heading,sub,rounds});
  const c=(vp,label)=>({kind:'count',vp,label});
  const k=(vp,label)=>({kind:'check',vp,label});
  const R=(text,...parts)=>({text,parts});
  const R4='Round 4 and game end', END='Game end', R246='Rounds 2, 4 and 6';
  const big=size=>size!=='skirmish';                        // "Only use in Clash, Battle & Reconquest"
  const kp=size=>size==='skirmish'?100:200;                  // 9.5 halves the 200 KP of Attrition
  const pts=size=>size==='skirmish'?100:200;                 // and the 200pts of Displace

  // 9.6.1 Attrition X
  const attrition=(x,size,note='')=>[H('Attrition',END,[6]),R(`Every ${kp(size)} KP you have scored${note}`,c(x))];
  // 9.6.2 Extract X/Y
  const extract=(x,y,{hold=false}={})=>[H('Extract','',[6]),...(hold?[]:[R('Object Extracted',c(x))]),R('Object you Carry but have not Extracted, at the end of the game',c(y))];
  // 9.6.3 Displace X
  const displace=(x,size,where)=>[H('Displace',END,[6]),R(`Every ${pts(size)}pts of Vehicles ${where}`,c(x))];
  // 9.6.4 Dominate X/Y
  const dominate=(x,y,what,sub,rounds)=>[H('Dominate',sub,rounds),R(what,c(x,'Dominate'),c(y,'Challenge'))];
  // 9.6.5 Explore X
  const explore=(x,what)=>[H('Explore'),R(what,c(x))];
  // 9.6.6 Occupy X/Y
  const occupy=(x,y,what,sub,rounds)=>[H('Occupy',sub,rounds),R(what,c(x,'Control'),c(y,'Contest'))];
  // 9.6.7 Protect X/Y: X if not Compromised, or Y if Compromised but not destroyed, so no Zone counts twice
  const protect=(x,y,what)=>[H('Protect',END,[6]),R(`${what}, not Compromised`,c(x)),R(`${what}, Compromised, not destroyed`,c(y))];
  // 9.6.8 Raze X/Y
  const raze=(x,y,what,once)=>[H('Raze','',[6]),R(`${what} destroyed`,once?k(x):c(x)),R(`${what} Compromised at the end of the game`,once?k(y):c(y))];
  // 9.6.9 Secure X/Y
  const secure=(x,y,what)=>R(what,c(x,'Secure'),c(y,'Challenge'));

  window.DZ_SHEETS={
    'battle-royale':({size})=>[...attrition(2,size)],

    'bunker-complex':()=>[
      H('Secure',R4,[4,6]),secure(3,1,'Bunker Entrance'),
      ...occupy(3,1,'Bunker Entrance',R4,[4,6])],

    'castles':({v})=>[
      ...protect(3,1,'Red or Green Zone in your Table half'),
      H('Dominate',END,[6]),
      ...(v==='1'
        ?[R('Your Table half',c(1,'Challenge')),R('Your opponent’s Table half',c(3,'Dominate'),c(1,'Challenge'))]
        :[R('Your Table half',c(3,'Dominate'),c(1,'Challenge')),R('Your opponent’s Table half',c(1,'Challenge'))])],

    'command-and-control':({v})=>[
      H('Secure',R4,[4,6]),secure(3,1,'Point'),
      ...(v==='2'?occupy(4,2,'Yellow or green Zone',R4,[4,6]):extract(4,2))],

    'crucible':({size,v})=>[
      H('Secure',R4,[4,6]),secure(6,2,'Point'),
      ...attrition(2,size),
      ...extract(3,1,{hold:v==='1'}),
      // Variant 2 makes the yellow Zones Large; they are only on the table in Clash and up
      ...(v==='2'&&big(size)?raze(4,2,'The yellow Zone in your opponent’s table half',true):[])],

    'demolish':()=>[
      ...raze(3,1,'Red or green Zone in your opponent’s table half'),
      ...dominate(3,1,'Table half',END,[6])],

    'domination':({size,v})=>[
      ...dominate(2,1,'Table quarter',R4,[4,6]),
      ...displace(1,size,'within the table quarter containing your opponent’s Territory'),
      ...(v==='2'?occupy(4,2,'Green or red Zone',R4,[4,6]):extract(3,1))],

    'encroach':({v})=>[
      H('Secure',R246,[2,4,6]),secure(2,1,'Point'),
      ...extract(3,1),
      ...(v==='2'?explore(1,'Non-green Zone in your opponent’s Table half'):[])],

    'ground-control':({size,v})=>[
      ...dominate(4,2,'Table quarter',R4,[4,6]),
      ...displace(1,size,'within the table quarter containing your opponent’s Territory'),
      // printed 1/2
      ...(v==='2'?[H('Secure',END,[6]),secure(1,2,'Zone')]:[])],

    'kill-box':()=>[
      H('Secure',R4,[4,6]),secure(4,2,'Point'),
      ...extract(4,2)],

    'strategic-points':({size,v})=>[
      H('Secure',END,[6]),
      secure(6,2,'Magenta point'),
      secure(3,1,'Yellow point'),
      ...(big(size)?[secure(3,1,'Red point')]:[]),
      ...(v==='1'?occupy(3,1,'Secure point Zone',END,[6]):[]),
      ...(v==='2'?dominate(3,1,'Table quarter',END,[6]):attrition(1,size))],

    'targets-of-opportunity':({v})=>[
      H('Secure',R4,[4,6]),secure(2,1,'Zone'),
      ...extract(4,2),
      // 9.7.8.1 Data Download: 1 additional VP for every Cleanup Phase it spends inside the Zone in which it was found
      ...(v==='1'?[H('Data Download'),R('Cleanup Phase a found Object spends inside the Zone it was found in',c(1))]:[])],

    'pest-control':({size})=>[
      ...extract(2,1),
      ...attrition(1,size,' (destroyed Fauna count)')],

    'death-from-below':({v})=>[
      ...extract(3,1),
      ...(v==='1'?[]:[H('Secure',R4,[4,6]),secure(2,1,'Point')])],

    // The Variant adds Attrition without a VP value, so it has no line here: score it under Other VP
    'hunting-grounds-nest':({v})=>[
      ...(v==='1'?[]:occupy(3,1,'Zone',R4,[4,6])),
      H('Secure',R4,[4,6]),secure(2,1,'Point')],

    'hunting-grounds-typhon':()=>[
      H('Secure','Rounds 2, 4 and game end',[2,4,6]),secure(3,1,'Zone'),
      ...explore(1,'Zone'),
      ...dominate(3,1,'Table half, measured diagonally','Rounds 2, 4 and game end',[2,4,6])],
  };
})();

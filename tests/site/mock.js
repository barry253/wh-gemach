const R2 = 'https://pub-ccb909d9c0d644b5bf1f9f2b769e9365.r2.dev';
const cats = [
  ['catWC','Wheelchairs','🦽',['wheel chair','transport chair'],10],
  ['catWK','Walkers & Rollators','🚶',['rollator','walking frame'],20],
  ['catCC','Crutches & Canes','🩼',['crutch','cane','walking stick'],30],
  ['catKS','Knee Scooters','🛴',['knee walker','scooter'],40],
  ['catBT','Orthopedic Boots','🥾',['walking boot','cam boot','aircast','moon boot'],50],
  ['catBA','Bathroom Safety','🚿',['shower','bath','toilet','commode'],60],
  ['catBH','Bedroom & Home Care','🛏️',['bed','mattress','home care'],70],
  ['catBB','Baby & Kids','👶',['baby','infant','toddler','pram','buggy'],80],
  ['catSH','Simchas & Hosting','🍽️',['party','kiddush','sheva brachos','tablecloth'],90],
  ['catEM','Empty Category','❓',[],95],
  ['catWD','Wedding & Simcha Decor','💐',['wedding','chuppah','centerpiece','shtick','kallah'],85],
  ['catGW','Gowns','👗',['gown','dress','kallah','bridal','mother of the bride'],86],
].map(([id,name,icon,keywords,displayOrder])=>({id,name,icon,keywords,displayOrder}));
let n=0;
const it = (name, categoryId, total, avail, desc, photo=true) => ({ id: 'recItem' + (++n).toString().padStart(3,'0'), name, description: desc||'', totalUnits: total, availableCount: avail, hasPhoto: photo, photoUrl: photo ? `${R2}/items/${n}.jpg` : null, categoryId });
const medItems = [
  it('Wheelchair','catWC',6,3,'Standard 18" folding wheelchair with removable footrests.'),
  it('Wheelchair — Transport','catWC',3,0,'Lightweight transport chair — must be pushed by a companion.'),
  it('Walker — Standard','catWK',8,5,'Folding aluminum walker, height adjustable.'),
  it('Walker — With Seat','catWK',4,1,'Rollator with seat, hand brakes and basket.'),
  it('Walker — Space Saver','catWK',2,2,'Narrow folding walker for tight spaces.',false),
  it('Walker — 3-legged','catWK',1,0,'',false),
  it('Crutches','catCC',10,7,'Adjustable underarm crutches (adult).'),
  it('Crutches — Forearm','catCC',4,2,''),
  it('Crutches — Tall','catCC',2,1,'For heights 5\'10" – 6\'6".',false),
  it('Canes','catCC',6,4,'Single-point and quad canes.'),
  it('Knee Scooter','catKS',5,2,'Steerable knee walker with basket and hand brake. Great for foot and ankle injuries.'),
  it('Boot — XS','catBT',2,2,'',false), it('Boot — S','catBT',3,1,'',false), it('Boot — M','catBT',4,0,'',false),
  it('Boot — L','catBT',4,2,'',false), it('Boot — XL','catBT',2,1,'',false),
  it('Shower Seat','catBA',4,2,'Adjustable-height shower chair with back.'),
  it('Tub Bench','catBA',2,0,''),
  it('Transfer Shower Chair','catBA',2,1,'Tub transfer bench that straddles the tub wall.'),
  it('Toilet Seat Riser','catBA',3,3,'Raised toilet seat with arms.'),
  it('Commode','catBA',3,1,'3-in-1 bedside commode.'),
  it('Mattress Cover','catBH',5,5,'Waterproof mattress protector, twin/full.',false),
];
const babyItems = [
  it('Stroller','catBB',4,2,'Full-size stroller with canopy and basket.'),
  it('Double Stroller','catBB',1,0,'Side-by-side double stroller.'),
  it("Pack 'n Play",'catBB',5,3,'Portable crib / playard — perfect for Yom Tov guests.'),
  it('High Chair','catBB',3,1,''),
  it('Infant Car Seat','catBB',2,2,'Rear-facing infant seat. Check the expiration date before use.',false),
  it('Baby Bath','catBB',2,2,'',false),
];
const simchaItems = [
  it('Round Tablecloths (white)','catSH',60,60,'For 60" round tables.',false),
  it('Chafing Dishes','catSH',20,20,'Full-size chafing dishes with frames.',false),
];
const shtickItems = [
  it('Shtick Bin — Classic','catWD',3,2,'Hats, signs, glasses, confetti cannons and more for the dancing.'),
  it('Chuppah Poles & Canopy','catWD',1,1,'Four wooden poles and a white canopy.'),
  it('Centerpiece Vases (set of 12)','catWD',4,0,'Tall glass cylinder vases.',false),
  it('Light-up Signs','catWD',6,3,'"Mazel Tov" LED signs.'),
];
const gownItems = [
  it('Kallah Gowns','catGW',40,40,'Sizes 2–18, a range of styles.'),
  it("Mother's Gowns",'catGW',60,60,'Evening gowns for mothers of the chassan and kallah.'),
  it('Girls Gowns','catGW',30,30,'Flower girl and sister gowns, ages 3–14.',false),
];
const V3 = { primaryContact:null, secondaryContact:null, logoUrl:null, themeColor:'#1B3A4B', accentColor:null,
  depositRequired:false, depositInfo:null, gemachInfo:null, requestStyle:'Dates', eventLabel:'Event date',
  pickupDaysBefore:1, returnDaysAfter:1, shabbosAdjust:false };
const gemachs = [
  { id:'recG1', slug:'wh-medical', name:'West Hempstead Medical Gemach', tagline:'Wheelchairs, walkers, crutches and more — lent free to anyone in the community.',
    description:'We lend medical and mobility equipment at no charge to anyone in the West Hempstead community.\n\nSelect what you need below and send a request — we\'ll get back to you, usually within 24 hours, to arrange pickup.\nPlease return items clean and in the condition you received them.\n\n<script>alert(1)</script> Learn more at https://example.org/medical-gemach.',
    category:'Medical', mode:'Full', phone:'(718) 986-7345', email:'whmedicalgemach@gmail.com', whatsapp:'718-986-7345', website:null,
    donationUrl:'https://www.anshei.org/medical-gemach', hours:'By appointment\nSun–Thu, evenings', logoUrl:null, communityName:'West Hempstead', displayOrder:10, items: medItems,
    ...V3, primaryContact:'Call', secondaryContact:'WhatsApp', accentColor:'#E0A63A',
    logoUrl:R2+'/wh-medical/logo-light/1.svg', logoDarkUrl:R2+'/wh-medical/logo-dark/1.svg' },
  { id:'recG5', slug:'wedding-shtick', name:'Simcha Shtick Gemach', tagline:'Shtick, chuppah and simcha decor — so every chassan and kallah can dance with joy.',
    description:'Borrow everything you need to make the dancing unforgettable.\nPick up the day before, return the day after.',
    category:'Simchas', mode:'Full', phone:'(516) 555-0123', email:'shtick.example@gmail.com', whatsapp:null, website:null,
    donationUrl:'https://example.org/donate-shtick', hours:'Sun–Thu 8–10pm\nFriday by arrangement', communityName:'West Hempstead', displayOrder:15, items: shtickItems,
    ...V3, primaryContact:'WhatsApp', secondaryContact:'Text', logoUrl:R2+'/wedding-shtick/logo/1700000000000.png',
    themeColor:'#7B2D5B', accentColor:'#E0B84F', depositRequired:true, depositInfo:'A $100 refundable deposit (check or cash) is due at pickup.\nReturned in full when everything comes back.',
    gemachInfo:'Please return items clean and packed in the bins they came in. <b>No</b> confetti inside the hall!\n\nQuestions? See https://example.org/shtick-faq.', requestStyle:'Event', eventLabel:'Wedding date',
    pickupDaysBefore:1, returnDaysAfter:1, shabbosAdjust:true },
  { id:'recG6', slug:'gowns', name:'Ahavas Chesed Gown Gemach', tagline:'Beautiful gowns for kallahs, mothers and sisters — try on by appointment.',
    description:'Our volunteers will help you find the right gown in a private fitting.',
    category:'Simchas', mode:'Full', phone:'(516) 555-0166', email:'gowns.example@gmail.com', whatsapp:'516-555-0167', website:null,
    donationUrl:null, hours:null, communityName:'West Hempstead', displayOrder:16, items: gownItems,
    ...V3, primaryContact:'Email', secondaryContact:'Call', themeColor:'#F4D9E0', requestStyle:'Appointment', eventLabel:'Simcha date',
    gemachInfo:'Appointments are about 45 minutes. Please bring the shoes you plan to wear.' },
  { id:'recG2', slug:'baby-gear', name:'Bais Chaim Baby Gear Gemach', tagline:'Strollers, cribs and baby essentials for families and visiting grandchildren.',
    description:'Borrow baby equipment for Yom Tov guests, visiting grandchildren or while you wait for your own. Everything is cleaned between loans.',
    category:'Baby & Kids', mode:'Full', phone:'(516) 555-0142', email:'babygear.example@gmail.com', whatsapp:'516-555-0142', website:'https://example.com/baby-gear',
    donationUrl:null, hours:'Sun–Thu 7–9pm', logoUrl:null, communityName:'West Hempstead', displayOrder:20, items: babyItems },
  { id:'recG3', slug:'simcha-gemach', name:'Simcha Hosting Gemach', tagline:'Tablecloths and chafing dishes for your simcha or kiddush.',
    description:'Call or WhatsApp to check availability and arrange pickup.', category:'Simchas', mode:'Directory',
    phone:'(516) 555-0199', email:null, whatsapp:'5165550199', website:null, donationUrl:null, hours:null, logoUrl:null,
    communityName:'West Hempstead', displayOrder:null, items: simchaItems,
    ...V3, requestStyle:'Appointment', themeColor:'bogus' },
  { id:'recG4', slug:'kallah-gowns', name:'Kallah Gown Gemach', tagline:'Wedding gowns for kallahs, by appointment.',
    description:'', category:'Simchas', mode:'Directory', phone:'(516) 555-0177', email:'gowns.example@gmail.com', whatsapp:null,
    website:null, donationUrl:null, hours:'By appointment', logoUrl:null, communityName:'West Hempstead', displayOrder:null, items: [] },
];
const directory = { categories: cats, gemachs, generatedAt: new Date().toISOString() };
function gemachPayload(slug) {
  const g = gemachs.find(x => x.slug === slug);
  if (!g) return null;
  const { items, ...profile } = g;
  return { gemach: profile, items, categories: cats };
}
module.exports = { directory, gemachPayload, R2 };

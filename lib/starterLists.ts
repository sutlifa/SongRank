// lib/starterLists.ts
//
// Ready-made song lists, so someone can start ranking in one click instead of
// typing out forty titles first. Pure data and pure lookups: no React, no Next
// imports, no network -- the one starter that isn't fixed (the live chart) is
// fetched in lib/charts.ts and only shares this file's `StarterList` shape.
//
// ## Why title + artist, and not pasted text
//
// The obvious implementation is to keep each list as a block of text and push
// it through the paste box. That would be throwing away information on
// purpose. lib/parse.ts exists to *guess* which half of "Africa - Toto" is the
// title, because a human pasting a list gives us nothing better to go on. Here
// we know, because we wrote it down. So a starter skips the parser entirely
// and arrives as structured drafts, which then take the ordinary /new route:
// preview resolution on Continue, then the pre-flight check, then the same
// shuffle-and-save as any other ranking. Nothing downstream can tell a starter
// from a hand-built list, which is the point -- there is no second code path to
// keep in step.
//
// ## On the contents
//
// These are picked to be recognisable and to argue with each other. A list
// where one song obviously wins teaches the ranking engine nothing and is
// boring to play; every list here is meant to have no comfortable answer.
// Artists repeat within a list only where leaving them out would be strange
// (a Beatles list is all Beatles; a country list without two Johnny Cash songs
// is missing something), because a list that is half one artist spends its
// most informative early matchups on a single discography.
//
// Titles and artists are written the way Apple's catalogue lists them, since
// that is what they are matched against. Where a song is famous in two
// recordings -- a film vocal and an end-credits pop single -- the performer
// named is the one from the version people mean. An imperfect artist still
// resolves: lib/itunes.ts falls back to searching the title alone.

/** How the browse page groups lists. Order here is the order on screen. */
export const STARTER_CATEGORIES = ["featured", "genre", "decade", "collection"] as const;
export type StarterCategory = (typeof STARTER_CATEGORIES)[number];

export const STARTER_CATEGORY_LABELS: Record<StarterCategory, string> = {
    featured: "Start here",
    genre: "By genre",
    decade: "By decade",
    collection: "Collections",
};

export const STARTER_CATEGORY_BLURBS: Record<StarterCategory, string> = {
    featured: "Broad lists with no obvious winner — a good first ranking.",
    genre: "One corner of music at a time.",
    decade: "The songs that defined a stretch of years.",
    collection: "A single artist, or a single world.",
};

export interface StarterSong {
    title: string;
    artist: string;
}

export interface StarterList {
    /** URL slug: /new?starter=<id>. Stable -- it ends up in shared links. */
    id: string;
    title: string;
    /** One line, shown on the card. Says what the list is, not how good it is. */
    blurb: string;
    category: StarterCategory;
    /** Shown on the card so a list reads as a thing, not a row in a table. */
    emoji: string;
    songs: StarterSong[];
}

const LISTS: StarterList[] = [
    {
        id: "all-time-greats",
        title: "All-Time Greats",
        blurb: "Thirty songs that turn up on every greatest-ever list. Good luck.",
        category: "featured",
        emoji: "🏆",
        songs: [
            { title: "Like a Rolling Stone", artist: "Bob Dylan" },
            { title: "Respect", artist: "Aretha Franklin" },
            { title: "Imagine", artist: "John Lennon" },
            { title: "What's Going On", artist: "Marvin Gaye" },
            { title: "Hey Jude", artist: "The Beatles" },
            { title: "Smells Like Teen Spirit", artist: "Nirvana" },
            { title: "Good Vibrations", artist: "The Beach Boys" },
            { title: "Johnny B. Goode", artist: "Chuck Berry" },
            { title: "Purple Haze", artist: "Jimi Hendrix" },
            { title: "Superstition", artist: "Stevie Wonder" },
            { title: "Billie Jean", artist: "Michael Jackson" },
            { title: "Bohemian Rhapsody", artist: "Queen" },
            { title: "Born to Run", artist: "Bruce Springsteen" },
            { title: "London Calling", artist: "The Clash" },
            { title: "Waterloo Sunset", artist: "The Kinks" },
            { title: "A Change Is Gonna Come", artist: "Sam Cooke" },
            { title: "My Girl", artist: "The Temptations" },
            { title: "Dancing Queen", artist: "ABBA" },
            { title: "Hotel California", artist: "Eagles" },
            { title: "Sweet Child O' Mine", artist: "Guns N' Roses" },
            { title: "No Woman No Cry", artist: "Bob Marley & The Wailers" },
            { title: "Let's Stay Together", artist: "Al Green" },
            { title: "Gimme Shelter", artist: "The Rolling Stones" },
            { title: "Heroes", artist: "David Bowie" },
            { title: "Stayin' Alive", artist: "Bee Gees" },
            { title: "Every Breath You Take", artist: "The Police" },
            { title: "Rolling in the Deep", artist: "Adele" },
            { title: "Lose Yourself", artist: "Eminem" },
            { title: "One", artist: "U2" },
            { title: "Creep", artist: "Radiohead" },
        ],
    },
    {
        id: "classic-rock",
        title: "Classic Rock Essentials",
        blurb: "Every song the radio has played twice a day since 1977.",
        category: "genre",
        emoji: "🎸",
        songs: [
            { title: "Stairway to Heaven", artist: "Led Zeppelin" },
            { title: "Comfortably Numb", artist: "Pink Floyd" },
            { title: "Baba O'Riley", artist: "The Who" },
            { title: "Free Bird", artist: "Lynyrd Skynyrd" },
            { title: "More Than a Feeling", artist: "Boston" },
            { title: "Carry On Wayward Son", artist: "Kansas" },
            { title: "Don't Stop Believin'", artist: "Journey" },
            { title: "Layla", artist: "Derek & The Dominos" },
            { title: "Paint It Black", artist: "The Rolling Stones" },
            { title: "Black Dog", artist: "Led Zeppelin" },
            { title: "Barracuda", artist: "Heart" },
            { title: "Dream On", artist: "Aerosmith" },
            { title: "American Girl", artist: "Tom Petty & The Heartbreakers" },
            { title: "Back in Black", artist: "AC/DC" },
            { title: "Fortunate Son", artist: "Creedence Clearwater Revival" },
            { title: "Go Your Own Way", artist: "Fleetwood Mac" },
            { title: "Rocket Man", artist: "Elton John" },
            { title: "Piano Man", artist: "Billy Joel" },
            { title: "Born to Be Wild", artist: "Steppenwolf" },
            { title: "Smoke on the Water", artist: "Deep Purple" },
            { title: "Roxanne", artist: "The Police" },
            { title: "Life in the Fast Lane", artist: "Eagles" },
            { title: "Sultans of Swing", artist: "Dire Straits" },
            { title: "Space Oddity", artist: "David Bowie" },
            { title: "Wish You Were Here", artist: "Pink Floyd" },
            { title: "China Grove", artist: "The Doobie Brothers" },
            { title: "Light My Fire", artist: "The Doors" },
            { title: "Iron Man", artist: "Black Sabbath" },
        ],
    },
    {
        id: "90s-alternative",
        title: "90s Alternative",
        blurb: "Flannel, distortion pedals and a lot of feelings.",
        category: "genre",
        emoji: "📼",
        songs: [
            { title: "Smells Like Teen Spirit", artist: "Nirvana" },
            { title: "Creep", artist: "Radiohead" },
            { title: "Loser", artist: "Beck" },
            { title: "Black Hole Sun", artist: "Soundgarden" },
            { title: "Alive", artist: "Pearl Jam" },
            { title: "Today", artist: "The Smashing Pumpkins" },
            { title: "Longview", artist: "Green Day" },
            { title: "Self Esteem", artist: "The Offspring" },
            { title: "Cannonball", artist: "The Breeders" },
            { title: "Zombie", artist: "The Cranberries" },
            { title: "Bitter Sweet Symphony", artist: "The Verve" },
            { title: "Wonderwall", artist: "Oasis" },
            { title: "Song 2", artist: "Blur" },
            { title: "No Rain", artist: "Blind Melon" },
            { title: "Bulls on Parade", artist: "Rage Against the Machine" },
            { title: "Man in the Box", artist: "Alice in Chains" },
            { title: "Interstate Love Song", artist: "Stone Temple Pilots" },
            { title: "1979", artist: "The Smashing Pumpkins" },
            { title: "Under the Bridge", artist: "Red Hot Chili Peppers" },
            { title: "Closing Time", artist: "Semisonic" },
            { title: "Fake Plastic Trees", artist: "Radiohead" },
            { title: "Glycerine", artist: "Bush" },
            { title: "Santeria", artist: "Sublime" },
            { title: "Losing My Religion", artist: "R.E.M." },
            { title: "Heart-Shaped Box", artist: "Nirvana" },
            { title: "Everlong", artist: "Foo Fighters" },
            { title: "Semi-Charmed Life", artist: "Third Eye Blind" },
            { title: "Sabotage", artist: "Beastie Boys" },
        ],
    },
    {
        id: "hip-hop-classics",
        title: "Hip-Hop Classics",
        blurb: "Four decades of it, from the Sugarhill Gang to Kendrick.",
        category: "genre",
        emoji: "🎤",
        songs: [
            { title: "Juicy", artist: "The Notorious B.I.G." },
            { title: "N.Y. State of Mind", artist: "Nas" },
            { title: "C.R.E.A.M.", artist: "Wu-Tang Clan" },
            { title: "Nuthin' but a 'G' Thang", artist: "Dr. Dre" },
            { title: "California Love", artist: "2Pac" },
            { title: "Lose Yourself", artist: "Eminem" },
            { title: "Dear Mama", artist: "2Pac" },
            { title: "The Message", artist: "Grandmaster Flash & The Furious Five" },
            { title: "Fight the Power", artist: "Public Enemy" },
            { title: "Rapper's Delight", artist: "The Sugarhill Gang" },
            { title: "It Was a Good Day", artist: "Ice Cube" },
            { title: "Shook Ones, Pt. II", artist: "Mobb Deep" },
            { title: "Jesus Walks", artist: "Kanye West" },
            { title: "Hey Ya!", artist: "OutKast" },
            { title: "Ms. Jackson", artist: "OutKast" },
            { title: "Big Poppa", artist: "The Notorious B.I.G." },
            { title: "Stan", artist: "Eminem" },
            { title: "Passin' Me By", artist: "The Pharcyde" },
            { title: "Scenario", artist: "A Tribe Called Quest" },
            { title: "Can I Kick It?", artist: "A Tribe Called Quest" },
            { title: "Gin and Juice", artist: "Snoop Dogg" },
            { title: "Empire State of Mind", artist: "JAY-Z" },
            { title: "99 Problems", artist: "JAY-Z" },
            { title: "Alright", artist: "Kendrick Lamar" },
            { title: "m.A.A.d city", artist: "Kendrick Lamar" },
            { title: "SICKO MODE", artist: "Travis Scott" },
            { title: "Gold Digger", artist: "Kanye West" },
            { title: "Mo Money Mo Problems", artist: "The Notorious B.I.G." },
        ],
    },
    {
        id: "rnb-soul",
        title: "R&B and Soul",
        blurb: "Stax and Motown through to the quiet storm and back out again.",
        category: "genre",
        emoji: "💜",
        songs: [
            { title: "What's Going On", artist: "Marvin Gaye" },
            { title: "Respect", artist: "Aretha Franklin" },
            { title: "Let's Stay Together", artist: "Al Green" },
            { title: "Superstition", artist: "Stevie Wonder" },
            { title: "I Heard It Through the Grapevine", artist: "Marvin Gaye" },
            { title: "A Change Is Gonna Come", artist: "Sam Cooke" },
            { title: "My Girl", artist: "The Temptations" },
            { title: "(Sittin' On) the Dock of the Bay", artist: "Otis Redding" },
            { title: "Ain't No Sunshine", artist: "Bill Withers" },
            { title: "Lean on Me", artist: "Bill Withers" },
            { title: "I Want You Back", artist: "The Jackson 5" },
            { title: "Papa Was a Rollin' Stone", artist: "The Temptations" },
            { title: "Signed, Sealed, Delivered I'm Yours", artist: "Stevie Wonder" },
            { title: "Killing Me Softly With His Song", artist: "Roberta Flack" },
            { title: "No Scrubs", artist: "TLC" },
            { title: "Waterfalls", artist: "TLC" },
            { title: "I Will Always Love You", artist: "Whitney Houston" },
            { title: "Vision of Love", artist: "Mariah Carey" },
            { title: "End of the Road", artist: "Boyz II Men" },
            { title: "Un-Break My Heart", artist: "Toni Braxton" },
            { title: "Say My Name", artist: "Destiny's Child" },
            { title: "Adorn", artist: "Miguel" },
            { title: "Best Part", artist: "Daniel Caesar" },
            { title: "Cranes in the Sky", artist: "Solange" },
            { title: "Pink + White", artist: "Frank Ocean" },
            { title: "Blinding Lights", artist: "The Weeknd" },
            { title: "Redbone", artist: "Childish Gambino" },
        ],
    },
    {
        id: "country-classics",
        title: "Country Classics",
        blurb: "Outlaws, heartbreak and one very persistent woman named Jolene.",
        category: "genre",
        emoji: "🤠",
        songs: [
            { title: "Jolene", artist: "Dolly Parton" },
            { title: "Ring of Fire", artist: "Johnny Cash" },
            { title: "Folsom Prison Blues", artist: "Johnny Cash" },
            { title: "He Stopped Loving Her Today", artist: "George Jones" },
            { title: "Crazy", artist: "Patsy Cline" },
            { title: "Stand by Your Man", artist: "Tammy Wynette" },
            { title: "Friends in Low Places", artist: "Garth Brooks" },
            { title: "The Dance", artist: "Garth Brooks" },
            { title: "Always on My Mind", artist: "Willie Nelson" },
            { title: "On the Road Again", artist: "Willie Nelson" },
            { title: "Coal Miner's Daughter", artist: "Loretta Lynn" },
            { title: "9 to 5", artist: "Dolly Parton" },
            { title: "Amarillo by Morning", artist: "George Strait" },
            { title: "Mama Tried", artist: "Merle Haggard" },
            { title: "Boot Scootin' Boogie", artist: "Brooks & Dunn" },
            { title: "Man! I Feel Like a Woman!", artist: "Shania Twain" },
            { title: "You're Still the One", artist: "Shania Twain" },
            { title: "Wide Open Spaces", artist: "The Chicks" },
            { title: "Goodbye Earl", artist: "The Chicks" },
            { title: "Before He Cheats", artist: "Carrie Underwood" },
            { title: "Need You Now", artist: "Lady A" },
            { title: "Wagon Wheel", artist: "Darius Rucker" },
            { title: "Cruise", artist: "Florida Georgia Line" },
            { title: "Tennessee Whiskey", artist: "Chris Stapleton" },
            { title: "The Gambler", artist: "Kenny Rogers" },
            { title: "Take Me Home, Country Roads", artist: "John Denver" },
            { title: "Chicken Fried", artist: "Zac Brown Band" },
        ],
    },
    {
        id: "eighties",
        title: "The Eighties",
        blurb: "Synths, gated drums and choruses engineered for stadiums.",
        category: "decade",
        emoji: "🕹️",
        songs: [
            { title: "Billie Jean", artist: "Michael Jackson" },
            { title: "Like a Prayer", artist: "Madonna" },
            { title: "Every Breath You Take", artist: "The Police" },
            { title: "Sweet Child O' Mine", artist: "Guns N' Roses" },
            { title: "Don't Stop Believin'", artist: "Journey" },
            { title: "Take On Me", artist: "a-ha" },
            { title: "Livin' on a Prayer", artist: "Bon Jovi" },
            { title: "With or Without You", artist: "U2" },
            { title: "Purple Rain", artist: "Prince" },
            { title: "When Doves Cry", artist: "Prince" },
            { title: "Under Pressure", artist: "Queen & David Bowie" },
            { title: "Africa", artist: "TOTO" },
            { title: "Time After Time", artist: "Cyndi Lauper" },
            { title: "Girls Just Want to Have Fun", artist: "Cyndi Lauper" },
            { title: "Tainted Love", artist: "Soft Cell" },
            { title: "Blue Monday", artist: "New Order" },
            { title: "Love Will Tear Us Apart", artist: "Joy Division" },
            { title: "Just Like Heaven", artist: "The Cure" },
            { title: "How Soon Is Now?", artist: "The Smiths" },
            { title: "Sweet Dreams (Are Made of This)", artist: "Eurythmics" },
            { title: "Karma Chameleon", artist: "Culture Club" },
            { title: "I Wanna Dance with Somebody (Who Loves Me)", artist: "Whitney Houston" },
            { title: "Beat It", artist: "Michael Jackson" },
            { title: "Eye of the Tiger", artist: "Survivor" },
            { title: "Jump", artist: "Van Halen" },
            { title: "Should I Stay or Should I Go", artist: "The Clash" },
            { title: "Fast Car", artist: "Tracy Chapman" },
            { title: "Don't You (Forget About Me)", artist: "Simple Minds" },
        ],
    },
    {
        id: "pop-2000s",
        title: "2000s Pop",
        blurb: "Ringtone-era pop, back when a single could own an entire summer.",
        category: "decade",
        emoji: "💿",
        songs: [
            { title: "Crazy in Love", artist: "Beyoncé" },
            { title: "Toxic", artist: "Britney Spears" },
            { title: "Hey Ya!", artist: "OutKast" },
            { title: "Since U Been Gone", artist: "Kelly Clarkson" },
            { title: "Umbrella", artist: "Rihanna" },
            { title: "Poker Face", artist: "Lady Gaga" },
            { title: "Hollaback Girl", artist: "Gwen Stefani" },
            { title: "SexyBack", artist: "Justin Timberlake" },
            { title: "I Kissed a Girl", artist: "Katy Perry" },
            { title: "Complicated", artist: "Avril Lavigne" },
            { title: "Beautiful", artist: "Christina Aguilera" },
            { title: "Clocks", artist: "Coldplay" },
            { title: "Mr. Brightside", artist: "The Killers" },
            { title: "Hips Don't Lie", artist: "Shakira" },
            { title: "Bye Bye Bye", artist: "*NSYNC" },
            { title: "Survivor", artist: "Destiny's Child" },
            { title: "Drop It Like It's Hot", artist: "Snoop Dogg" },
            { title: "Yeah!", artist: "Usher" },
            { title: "Hot in Herre", artist: "Nelly" },
            { title: "Get the Party Started", artist: "P!nk" },
            { title: "Stronger", artist: "Kanye West" },
            { title: "Viva La Vida", artist: "Coldplay" },
            { title: "Single Ladies (Put a Ring on It)", artist: "Beyoncé" },
            { title: "Rehab", artist: "Amy Winehouse" },
            { title: "Chasing Cars", artist: "Snow Patrol" },
            { title: "Just Dance", artist: "Lady Gaga" },
            { title: "The Middle", artist: "Jimmy Eat World" },
        ],
    },
    {
        id: "beatles",
        title: "The Beatles",
        blurb: "Thirty of them. There is no right answer and everyone has one.",
        category: "collection",
        emoji: "🍎",
        songs: [
            { title: "Hey Jude", artist: "The Beatles" },
            { title: "Let It Be", artist: "The Beatles" },
            { title: "Yesterday", artist: "The Beatles" },
            { title: "Come Together", artist: "The Beatles" },
            { title: "Something", artist: "The Beatles" },
            { title: "Here Comes the Sun", artist: "The Beatles" },
            { title: "A Day in the Life", artist: "The Beatles" },
            { title: "Strawberry Fields Forever", artist: "The Beatles" },
            { title: "Penny Lane", artist: "The Beatles" },
            { title: "Help!", artist: "The Beatles" },
            { title: "In My Life", artist: "The Beatles" },
            { title: "Eleanor Rigby", artist: "The Beatles" },
            { title: "Blackbird", artist: "The Beatles" },
            { title: "While My Guitar Gently Weeps", artist: "The Beatles" },
            { title: "I Want to Hold Your Hand", artist: "The Beatles" },
            { title: "She Loves You", artist: "The Beatles" },
            { title: "Twist and Shout", artist: "The Beatles" },
            { title: "Norwegian Wood (This Bird Has Flown)", artist: "The Beatles" },
            { title: "Ticket to Ride", artist: "The Beatles" },
            { title: "Lucy in the Sky with Diamonds", artist: "The Beatles" },
            { title: "All You Need Is Love", artist: "The Beatles" },
            { title: "Get Back", artist: "The Beatles" },
            { title: "Across the Universe", artist: "The Beatles" },
            { title: "Back in the U.S.S.R.", artist: "The Beatles" },
            { title: "Revolution", artist: "The Beatles" },
            { title: "A Hard Day's Night", artist: "The Beatles" },
            { title: "Michelle", artist: "The Beatles" },
            { title: "Don't Let Me Down", artist: "The Beatles" },
            { title: "Paperback Writer", artist: "The Beatles" },
            { title: "Golden Slumbers", artist: "The Beatles" },
        ],
    },
    {
        id: "disney-animated",
        title: "Disney Animated",
        blurb: "Ninety years of them. Expect an argument about Let It Go.",
        category: "collection",
        emoji: "🏰",
        songs: [
            { title: "Let It Go", artist: "Idina Menzel" },
            { title: "Circle of Life", artist: "Carmen Twillie" },
            { title: "A Whole New World", artist: "Brad Kane" },
            { title: "Under the Sea", artist: "Samuel E. Wright" },
            { title: "Part of Your World", artist: "Jodi Benson" },
            { title: "Be Our Guest", artist: "Angela Lansbury" },
            { title: "Beauty and the Beast", artist: "Angela Lansbury" },
            { title: "Hakuna Matata", artist: "Nathan Lane" },
            { title: "I Just Can't Wait to Be King", artist: "Jason Weaver" },
            { title: "Colors of the Wind", artist: "Judy Kuhn" },
            { title: "Reflection", artist: "Lea Salonga" },
            { title: "I'll Make a Man Out of You", artist: "Donny Osmond" },
            { title: "You'll Be in My Heart", artist: "Phil Collins" },
            { title: "Go the Distance", artist: "Roger Bart" },
            { title: "Friend Like Me", artist: "Robin Williams" },
            { title: "When You Wish Upon a Star", artist: "Cliff Edwards" },
            { title: "The Bare Necessities", artist: "Phil Harris" },
            { title: "A Dream Is a Wish Your Heart Makes", artist: "Ilene Woods" },
            { title: "Kiss the Girl", artist: "Samuel E. Wright" },
            { title: "How Far I'll Go", artist: "Auli'i Cravalho" },
            { title: "You're Welcome", artist: "Dwayne Johnson" },
            { title: "We Don't Talk About Bruno", artist: "Carolina Gaitán" },
            { title: "Surface Pressure", artist: "Jessica Darrow" },
            { title: "Into the Unknown", artist: "Idina Menzel" },
            { title: "Remember Me", artist: "Miguel" },
            { title: "Un Poco Loco", artist: "Anthony Gonzalez" },
            { title: "Try Everything", artist: "Shakira" },
            { title: "Almost There", artist: "Anika Noni Rose" },
            { title: "Touch the Sky", artist: "Julie Fowlis" },
            { title: "Zero to Hero", artist: "Lillias White" },
        ],
    },
];

/** Every fixed starter, in display order. The live chart is not here -- see
 * lib/charts.ts, which builds one of these at request time. */
export const CURATED_STARTERS: readonly StarterList[] = LISTS;

export function getCuratedStarter(id: string): StarterList | null {
    return LISTS.find((l) => l.id === id) ?? null;
}

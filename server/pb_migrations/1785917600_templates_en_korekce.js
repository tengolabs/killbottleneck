/// <reference path="../pb_data/types.d.ts" />
// Jazykové korekce EN šablon (nezávislá kontrola 5. 8. 2026, report
// Claude_Holly/killbottleneck-en-sablony-kontrola/report.md): 1 gramatická chyba,
// čechismy/kalky, sjednocení pomlček a velikosti písmen. Zdrojová migrace
// 1785519076 už na běžících instancích proběhla → tahle dorovnává JEN _en pole
// u 18 dotčených systémových šablon (owner == ''). Párování dle CZ title,
// chybějící se přeskočí — bezpečné přes fleet-update. S1 (zdroj goal_en
// u metodických šablon) VĚDOMĚ neřešeno — čeká rozhodnutí Richarda.
migrate((app) => {
  const DATA = [
 {
  "title": "Lean Canvas",
  "title_en": "Lean Canvas",
  "description_en": "9 blocks for quickly validating a startup/product (Ash Maurya).",
  "goal_en": "Lean Canvas (define your startup/product)",
  "ai_nodes_en": [
   {
    "id": "root",
    "title": "Lean Canvas (define your startup/product)",
    "description": "Describe the idea whose model you are validating.",
    "parentId": null
   },
   {
    "id": "lc1",
    "title": "Problem",
    "description": "Top 1–3 customer problems you are solving.",
    "parentId": "root"
   },
   {
    "id": "lc2",
    "title": "Customer Segments",
    "description": "Target customers and early adopters.",
    "parentId": "root"
   },
   {
    "id": "lc3",
    "title": "Unique Value Proposition",
    "description": "A clear message about why you're different and worth choosing.",
    "parentId": "root"
   },
   {
    "id": "lc4",
    "title": "Solution",
    "description": "Top 3 features that solve the problem.",
    "parentId": "root"
   },
   {
    "id": "lc5",
    "title": "Channels",
    "description": "Paths to reach your customers.",
    "parentId": "root"
   },
   {
    "id": "lc6",
    "title": "Revenue Streams",
    "description": "How you make money and from what.",
    "parentId": "root"
   },
   {
    "id": "lc7",
    "title": "Cost Structure",
    "description": "Main costs.",
    "parentId": "root"
   },
   {
    "id": "lc8",
    "title": "Key Metrics",
    "description": "Numbers you use to measure success.",
    "parentId": "root"
   },
   {
    "id": "lc9",
    "title": "Unfair Advantage",
    "description": "What cannot be easily copied or bought.",
    "parentId": "root"
   }
  ]
 },
 {
  "title": "Kanban tabule",
  "title_en": "Kanban Board",
  "description_en": "Visual management of work in columns (flow-based), with a work-in-progress (WIP) limit.",
  "goal_en": "Kanban – process/project (define)",
  "ai_nodes_en": [
   {
    "id": "root",
    "title": "Kanban – process/project (define)",
    "description": "Which workflow you want to manage visually.",
    "parentId": null
   },
   {
    "id": "k1",
    "title": "Backlog",
    "description": "Ideas and tasks waiting to be scheduled.",
    "parentId": "root"
   },
   {
    "id": "k2",
    "title": "To Do",
    "description": "Tasks ready to be started.",
    "parentId": "root"
   },
   {
    "id": "k3",
    "title": "In Progress",
    "description": "What is being worked on right now – limit the count (WIP limit).",
    "parentId": "root"
   },
   {
    "id": "k4",
    "title": "Review",
    "description": "Finished, awaiting review or approval.",
    "parentId": "root"
   },
   {
    "id": "k5",
    "title": "Done",
    "description": "Completed tasks.",
    "parentId": "root"
   }
  ]
 },
 {
  "title": "8D report (8 disciplín)",
  "title_en": "8D Report (8 Disciplines)",
  "description_en": "A structured 8-step problem-solving process (automotive).",
  "goal_en": "Problem (8D report)",
  "ai_nodes_en": [
   {
    "id": "root",
    "title": "Problem (8D report)",
    "description": "Describe the problem you're solving with the 8D (8 Disciplines) method.",
    "parentId": null
   },
   {
    "id": "d1",
    "title": "D1 – Team formation",
    "description": "Assemble a team with the necessary knowledge and authority.",
    "parentId": "root"
   },
   {
    "id": "d2",
    "title": "D2 – Problem description",
    "description": "Describe the problem precisely (what, where, when, extent).",
    "parentId": "root"
   },
   {
    "id": "d3",
    "title": "D3 – Interim containment actions",
    "description": "Put temporary measures in place so the problem causes no further harm.",
    "parentId": "root"
   },
   {
    "id": "d4",
    "title": "D4 – Root cause",
    "description": "Identify and verify the true root cause.",
    "parentId": "root"
   },
   {
    "id": "d5",
    "title": "D5 – Permanent corrective actions",
    "description": "Select permanent corrective actions.",
    "parentId": "root"
   },
   {
    "id": "d6",
    "title": "D6 – Implementation and validation",
    "description": "Implement the corrective action and verify its effectiveness.",
    "parentId": "root"
   },
   {
    "id": "d7",
    "title": "D7 – Recurrence prevention",
    "description": "Adjust the system so the problem doesn't recur.",
    "parentId": "root"
   },
   {
    "id": "d8",
    "title": "D8 – Closure and team recognition",
    "description": "Close the case and recognize the team.",
    "parentId": "root"
   }
  ]
 },
 {
  "title": "Najít novou práci",
  "title_en": "Find a New Job",
  "description_en": "From preparing your CV to signing a new contract.",
  "goal_en": "Find and land a better new job",
  "ai_nodes_en": [
   {
    "id": "root",
    "title": "Find and land a better new job",
    "description": "The goal is to identify, prepare for, and land a position that better matches your needs and skills.",
    "parentId": null
   },
   {
    "id": "f1",
    "title": "Research the market and your preferences",
    "description": "Map industry requirements and figure out which role suits you best.",
    "parentId": "root"
   },
   {
    "id": "f1a",
    "title": "Analyze industry trends",
    "description": "Review industry developments and demand for positions.",
    "parentId": "f1"
   },
   {
    "id": "f1b",
    "title": "Define your own criteria",
    "description": "Set requirements like salary, benefits, culture.",
    "parentId": "f1"
   },
   {
    "id": "f1c",
    "title": "Build a list of potential companies",
    "description": "Find companies that match your criteria.",
    "parentId": "f1"
   },
   {
    "id": "f2",
    "title": "Level up your skills and network",
    "description": "Improve your skills and expand your contacts for better chances.",
    "parentId": "root"
   },
   {
    "id": "f2a",
    "title": "Do a gap analysis",
    "description": "Find out which skills you're missing for the desired position.",
    "parentId": "f2"
   },
   {
    "id": "f2b",
    "title": "Take training or courses",
    "description": "Complete certifications that strengthen your profile.",
    "parentId": "f2"
   },
   {
    "id": "f2c",
    "title": "Build a professional network",
    "description": "Make connections on LinkedIn and at networking events.",
    "parentId": "f2"
   },
   {
    "id": "f3",
    "title": "Prepare applications and interviews",
    "description": "Optimize your CV and cover letter, and prepare for interviews.",
    "parentId": "root"
   },
   {
    "id": "f3a",
    "title": "Update your CV and LinkedIn",
    "description": "Include keywords and results.",
    "parentId": "f3"
   },
   {
    "id": "f3b",
    "title": "Prepare a cover letter",
    "description": "Tailor the letter to each specific company.",
    "parentId": "f3"
   },
   {
    "id": "f3c",
    "title": "Practice interviews",
    "description": "Rehearse questions and simulate scenarios.",
    "parentId": "f3"
   }
  ]
 },
 {
  "title": "Začít investovat",
  "title_en": "Start Investing",
  "description_en": "From investing basics to your first portfolio.",
  "goal_en": "Start investing money smartly and responsibly",
  "ai_nodes_en": [
   {
    "id": "root",
    "title": "Start investing money smartly and responsibly",
    "description": "Goal: start investing money smartly and responsibly.",
    "parentId": null
   },
   {
    "id": "f1",
    "title": "Financial foundation",
    "description": "Basic steps to build a stable financial base.",
    "parentId": "root"
   },
   {
    "id": "f1a",
    "title": "Assess your financial situation",
    "description": "Review your income, expenses, and savings.",
    "parentId": "f1"
   },
   {
    "id": "f1b",
    "title": "Set goals and a time frame",
    "description": "Define specific investment goals and when to reach them.",
    "parentId": "f1"
   },
   {
    "id": "f1c",
    "title": "Build an emergency fund",
    "description": "Set aside a reserve of 3–6 months of expenses.",
    "parentId": "f1"
   },
   {
    "id": "f2",
    "title": "Investment strategy",
    "description": "Design a strategy tailored to your risk profile.",
    "parentId": "root"
   },
   {
    "id": "f2a",
    "title": "Assess your risk tolerance",
    "description": "Assess how much risk you're willing to take.",
    "parentId": "f2"
   },
   {
    "id": "f2b",
    "title": "Choose investment vehicles",
    "description": "Split funds between stocks, bonds, and other assets.",
    "parentId": "f2"
   },
   {
    "id": "f2c",
    "title": "Cut costs",
    "description": "Pick low-cost funds and minimize fees.",
    "parentId": "f2"
   },
   {
    "id": "f3",
    "title": "Execution and monitoring",
    "description": "Put investments in place and review them regularly.",
    "parentId": "root"
   },
   {
    "id": "f3a",
    "title": "Open an investment account",
    "description": "Choose a suitable platform and make your first deposit.",
    "parentId": "f3"
   },
   {
    "id": "f3b",
    "title": "Rebalance regularly",
    "description": "Adjust your portfolio mix to match your planned allocation.",
    "parentId": "f3"
   },
   {
    "id": "f3c",
    "title": "Review goals and strategy",
    "description": "Update your goals and adjust the plan every 6–12 months.",
    "parentId": "f3"
   }
  ]
 },
 {
  "title": "Přestěhovat se do zahraničí",
  "title_en": "Move Abroad",
  "description_en": "Visa, housing, and work, step by step.",
  "goal_en": "Move abroad and start a new life",
  "ai_nodes_en": [
   {
    "id": "root",
    "title": "Move abroad and start a new life",
    "description": "Planning the steps to move and live abroad",
    "parentId": null
   },
   {
    "id": "f1",
    "title": "Preparation",
    "description": "Basic steps before the move itself",
    "parentId": "root"
   },
   {
    "id": "f1a",
    "title": "Choose a country",
    "description": "Pick the destination country based on your preferences and options",
    "parentId": "f1"
   },
   {
    "id": "f1b",
    "title": "Check the requirements",
    "description": "Find out the country's visa and entry requirements",
    "parentId": "f1"
   },
   {
    "id": "f1c",
    "title": "Improve your language skills",
    "description": "Gain basic language skills for communication",
    "parentId": "f1"
   },
   {
    "id": "f2",
    "title": "Legal and financial matters",
    "description": "Sorting out the legal and financial aspects of the move",
    "parentId": "root"
   },
   {
    "id": "f2a",
    "title": "Secure a visa",
    "description": "Apply for and obtain the necessary visa or residence permit",
    "parentId": "f2"
   },
   {
    "id": "f2b",
    "title": "Open an account",
    "description": "Set up a bank account in the destination country",
    "parentId": "f2"
   },
   {
    "id": "f2c",
    "title": "Budget and savings",
    "description": "Prepare a budget and make sure you have enough savings",
    "parentId": "f2"
   },
   {
    "id": "f3",
    "title": "Settle in",
    "description": "Integrate and set up your life in the new country",
    "parentId": "root"
   },
   {
    "id": "f3a",
    "title": "Find housing",
    "description": "Find and secure suitable housing",
    "parentId": "f3"
   },
   {
    "id": "f3b",
    "title": "Register and get documents",
    "description": "Register with the local authorities and get the necessary documents",
    "parentId": "f3"
   },
   {
    "id": "f3c",
    "title": "Integrate into the community",
    "description": "Get involved in the local community and make connections",
    "parentId": "f3"
   }
  ]
 },
 {
  "title": "Zlepšit se ve vaření",
  "title_en": "Get Better at Cooking",
  "description_en": "From basic techniques to your own recipes.",
  "goal_en": "Learn to cook and improve your kitchen skills",
  "ai_nodes_en": [
   {
    "id": "root",
    "title": "Learn to cook and improve your kitchen skills",
    "description": "The goal is to master cooking and expand your culinary repertoire.",
    "parentId": null
   },
   {
    "id": "f1",
    "title": "Cooking basics",
    "description": "Basic techniques and equipment needed to cook successfully.",
    "parentId": "root"
   },
   {
    "id": "f1a",
    "title": "Basic techniques",
    "description": "Learn what frying, braising, and baking are, and how they differ.",
    "parentId": "f1"
   },
   {
    "id": "f1b",
    "title": "Tool checklist",
    "description": "Get the essential equipment: a knife, pans, pots, and measuring cups.",
    "parentId": "f1"
   },
   {
    "id": "f1c",
    "title": "Simple dishes",
    "description": "Try a few basic recipes, e.g. dips and spreads, stir-fries, and soups.",
    "parentId": "f1"
   },
   {
    "id": "f2",
    "title": "Expand your recipe repertoire",
    "description": "Master your favorite dishes and learn to adapt them.",
    "parentId": "root"
   },
   {
    "id": "f2a",
    "title": "Pick dishes",
    "description": "Choose the dishes you want to master and make a list.",
    "parentId": "f2"
   },
   {
    "id": "f2b",
    "title": "Read recipes",
    "description": "Understand steps and timings, and add variations to your taste.",
    "parentId": "f2"
   },
   {
    "id": "f2c",
    "title": "Experiment with spices",
    "description": "Add spices and seasonings and try new combinations.",
    "parentId": "f2"
   },
   {
    "id": "f3",
    "title": "Improve your cooking skills",
    "description": "Refine your technique and efficiency in the kitchen.",
    "parentId": "root"
   },
   {
    "id": "f3a",
    "title": "Precise knife work",
    "description": "Practice cutting vegetables, meat, and other ingredients precisely.",
    "parentId": "f3"
   },
   {
    "id": "f3b",
    "title": "Meal planning",
    "description": "Use meal-prep techniques and plan the week's meals.",
    "parentId": "f3"
   },
   {
    "id": "f3c",
    "title": "Safety and hygiene",
    "description": "Follow hygiene practices and safety rules in the kitchen.",
    "parentId": "f3"
   }
  ]
 },
 {
  "title": "Naučit se fotit",
  "title_en": "Learn Photography",
  "description_en": "From mastering your camera to great shots.",
  "goal_en": "Learn to take great photos",
  "ai_nodes_en": [
   {
    "id": "root",
    "title": "Learn to take great photos",
    "description": "Goal: master photography skills.",
    "parentId": null
   },
   {
    "id": "f1",
    "title": "Gear and technical basics",
    "description": "Get to know your camera and learn to control its settings.",
    "parentId": "root"
   },
   {
    "id": "f1a",
    "title": "Get to know your camera",
    "description": "Go through the manual and check the lens features, white balance, and modes.",
    "parentId": "f1"
   },
   {
    "id": "f1b",
    "title": "Exposure basics",
    "description": "Learn to control ISO, aperture, and shutter speed for correct exposure.",
    "parentId": "f1"
   },
   {
    "id": "f1c",
    "title": "Manual mode",
    "description": "Master full manual mode and adjust exposure hands-on.",
    "parentId": "f1"
   },
   {
    "id": "f2",
    "title": "Composition and aesthetics",
    "description": "Understand composition rules and aesthetic elements.",
    "parentId": "root"
   },
   {
    "id": "f2a",
    "title": "Rule of thirds and golden ratio",
    "description": "Use the rule of thirds and the golden ratio for pleasing shots.",
    "parentId": "f2"
   },
   {
    "id": "f2b",
    "title": "Reading light and color",
    "description": "Notice and use light and color tones in your photography.",
    "parentId": "f2"
   },
   {
    "id": "f2c",
    "title": "Perspective and angles",
    "description": "Experiment with angles and perspective for interesting shots.",
    "parentId": "f2"
   },
   {
    "id": "f3",
    "title": "Practice and review",
    "description": "Improve through regular shooting and analyzing your photos.",
    "parentId": "root"
   },
   {
    "id": "f3a",
    "title": "Daily shooting",
    "description": "Shoot regularly and try out the techniques you've learned.",
    "parentId": "f3"
   },
   {
    "id": "f3b",
    "title": "Review and critique",
    "description": "Review your shots, spot mistakes, and get feedback.",
    "parentId": "f3"
   },
   {
    "id": "f3c",
    "title": "Build a portfolio",
    "description": "Put together a portfolio that shows your style and progress.",
    "parentId": "f3"
   }
  ]
 },
 {
  "title": "Naučit se anglicky",
  "title_en": "Learn English",
  "description_en": "Take your English to a fluent advanced level.",
  "goal_en": "Learn to speak English fluently at an advanced level",
  "ai_nodes_en": [
   {
    "id": "root",
    "title": "Learn to speak English fluently at an advanced level",
    "description": "Reach an advanced level of English in vocabulary, grammar, listening, pronunciation, speaking, and writing",
    "parentId": null
   },
   {
    "id": "f1",
    "title": "Advanced vocabulary and grammar",
    "description": "The core pillar of the advanced level",
    "parentId": "root"
   },
   {
    "id": "f1a",
    "title": "Expand vocabulary",
    "description": "Learn 3000 new words and phrases",
    "parentId": "f1"
   },
   {
    "id": "f1b",
    "title": "Practice grammar",
    "description": "Focus on advanced structures",
    "parentId": "f1"
   },
   {
    "id": "f2",
    "title": "Listening and pronunciation",
    "description": "Develop comprehension and correct pronunciation",
    "parentId": "root"
   },
   {
    "id": "f2a",
    "title": "Listen to English daily",
    "description": "1 hour of authentic material every day",
    "parentId": "f2"
   },
   {
    "id": "f2b",
    "title": "Drill pronunciation",
    "description": "Record yourself and analyze mistakes",
    "parentId": "f2"
   },
   {
    "id": "f3",
    "title": "Speaking and writing",
    "description": "Practical use of the language in real situations",
    "parentId": "root"
   },
   {
    "id": "f3a",
    "title": "Talk with native speakers",
    "description": "Speak with native speakers regularly",
    "parentId": "f3"
   },
   {
    "id": "f3b",
    "title": "Writing and feedback",
    "description": "Write essays and get critical feedback",
    "parentId": "f3"
   }
  ]
 },
 {
  "title": "Spustit YouTube kanál",
  "title_en": "Launch a YouTube Channel",
  "description_en": "From idea to a growing, money-making channel.",
  "goal_en": "Launch and grow a successful YouTube channel",
  "ai_nodes_en": [
   {
    "id": "root",
    "title": "Launch and grow a successful YouTube channel",
    "description": "The goal is to create and grow a channel with regular successful content.",
    "parentId": null
   },
   {
    "id": "f1",
    "title": "Define brand and target audience",
    "description": "Determine the topic and target audience the channel will appeal to.",
    "parentId": "root"
   },
   {
    "id": "f1a",
    "title": "Define a unique topic and style",
    "description": "Define the channel's distinctive focus and visual identity.",
    "parentId": "f1"
   },
   {
    "id": "f1b",
    "title": "Define your target audience and how you'll measure results",
    "description": "Define demographics and tools for tracking feedback.",
    "parentId": "f1"
   },
   {
    "id": "f2",
    "title": "Content creation and publishing",
    "description": "Prepare, record and publish videos according to the set plan.",
    "parentId": "root"
   },
   {
    "id": "f2a",
    "title": "Write scripts and record the first videos",
    "description": "Put together scripts and create the first content material.",
    "parentId": "f2"
   },
   {
    "id": "f2b",
    "title": "Optimize titles, descriptions and thumbnails",
    "description": "Make sure videos are easy to find and attractive.",
    "parentId": "f2"
   },
   {
    "id": "f2c",
    "title": "Establish a regular publishing schedule",
    "description": "Set and stick to a recording and publishing schedule.",
    "parentId": "f2"
   },
   {
    "id": "f3",
    "title": "Growth and monetization",
    "description": "Build an audience and generate income from the channel.",
    "parentId": "root"
   },
   {
    "id": "f3a",
    "title": "Gain subscribers and engagement",
    "description": "Drive subscriber growth through quality content and engagement.",
    "parentId": "f3"
   },
   {
    "id": "f3b",
    "title": "Seek collaborations and cross-promotion",
    "description": "Build partnerships and share content with other creators.",
    "parentId": "f3"
   },
   {
    "id": "f3c",
    "title": "Introduce monetization strategies",
    "description": "Implement ads, sponsorships, merch and other revenue streams.",
    "parentId": "f3"
   }
  ]
 },
 {
  "title": "Cesta kolem světa",
  "title_en": "Travel Around the World",
  "description_en": "Plan the budget, route and logistics of a big trip.",
  "goal_en": "Plan a long trip around the world",
  "ai_nodes_en": [
   {
    "id": "root",
    "title": "Plan a long trip around the world",
    "description": "Plan the basic route around the world",
    "parentId": null
   },
   {
    "id": "f1",
    "title": "Route planning",
    "description": "Map out the main stops and transfers",
    "parentId": "root"
   },
   {
    "id": "f1a",
    "title": "Choose main routes and places",
    "description": "Identify the key stops of the trip and transfer points",
    "parentId": "f1"
   },
   {
    "id": "f1b",
    "title": "Set a timeline",
    "description": "Schedule the length of stay at each place and the overall plan",
    "parentId": "f1"
   },
   {
    "id": "f1c",
    "title": "Find and book accommodation",
    "description": "Arrange accommodation and basic services at each location",
    "parentId": "f1"
   },
   {
    "id": "f2",
    "title": "Financial and logistical arrangements",
    "description": "Secure the budget, visas and means of transport",
    "parentId": "root"
   },
   {
    "id": "f2a",
    "title": "Create a budget",
    "description": "Estimate costs for transport, accommodation, food and other expenses",
    "parentId": "f2"
   },
   {
    "id": "f2b",
    "title": "Secure funding",
    "description": "Raise funds through savings, sponsors or loans",
    "parentId": "f2"
   },
   {
    "id": "f2c",
    "title": "Arrange insurance and travel documents",
    "description": "Get travel insurance and the required visas and passports",
    "parentId": "f2"
   },
   {
    "id": "f3",
    "title": "Personal and health preparation",
    "description": "Prepare for health, safety and personal aspects",
    "parentId": "root"
   },
   {
    "id": "f3a",
    "title": "Health check-up and vaccinations",
    "description": "Check your health and get the required vaccinations",
    "parentId": "f3"
   },
   {
    "id": "f3b",
    "title": "Prepare a safety and evacuation plan",
    "description": "Prepare for emergencies and evacuation scenarios",
    "parentId": "f3"
   }
  ]
 },
 {
  "title": "Naučit se na kytaru",
  "title_en": "Learn to Play Guitar",
  "description_en": "From first chords to playing your favorite songs.",
  "goal_en": "Learn to play the guitar",
  "ai_nodes_en": [
   {
    "id": "root",
    "title": "Learn to play the guitar",
    "description": "Goal: master playing the guitar",
    "parentId": null
   },
   {
    "id": "f1",
    "title": "Basics and technique",
    "description": "Basic technical skills for playing the guitar",
    "parentId": "root"
   },
   {
    "id": "f2",
    "title": "Repertoire and music theory",
    "description": "Expanding knowledge and repertoire",
    "parentId": "root"
   },
   {
    "id": "f3",
    "title": "Regular practice and improvement",
    "description": "Steady progress and maintaining skills",
    "parentId": "root"
   },
   {
    "id": "f1a",
    "title": "Get a guitar and equipment",
    "description": "Get a quality guitar and accessories",
    "parentId": "f1"
   },
   {
    "id": "f1b",
    "title": "Learn basic chords",
    "description": "Learn and practice basic chords and transitions",
    "parentId": "f1"
   },
   {
    "id": "f1c",
    "title": "Practice rhythm and hand position",
    "description": "Improve rhythm skills and playing ergonomics",
    "parentId": "f1"
   },
   {
    "id": "f2a",
    "title": "Learn music notation",
    "description": "Master notes and tablature for guitar",
    "parentId": "f2"
   },
   {
    "id": "f2b",
    "title": "Pick a first song",
    "description": "Choose a simple piece and break it down step by step",
    "parentId": "f2"
   },
   {
    "id": "f2c",
    "title": "Expand the repertoire",
    "description": "Add more songs and develop your style",
    "parentId": "f2"
   },
   {
    "id": "f3a",
    "title": "Set a practice plan",
    "description": "Determine the frequency and length of practice",
    "parentId": "f3"
   },
   {
    "id": "f3b",
    "title": "Daily practice and review",
    "description": "Practice every day and track progress",
    "parentId": "f3"
   },
   {
    "id": "f3c",
    "title": "Consult a teacher",
    "description": "Get feedback and refine your technique",
    "parentId": "f3"
   }
  ]
 },
 {
  "title": "Kariérní růst",
  "title_en": "Career Growth",
  "description_en": "A plan for advancing your career and achieving professional goals.",
  "goal_en": "Reach a senior specialist position",
  "ai_nodes_en": [
   {
    "id": "n1",
    "title": "Reach a senior specialist position",
    "description": "Main career goal for the next 2 years",
    "parentId": null
   },
   {
    "id": "n2",
    "title": "Developing professional expertise",
    "description": "Deepening technical skills",
    "parentId": "n1"
   },
   {
    "id": "n3",
    "title": "Certifications",
    "description": "Earn 2 industry certifications",
    "parentId": "n2"
   },
   {
    "id": "n4",
    "title": "Mentoring",
    "description": "Find a mentor in the field",
    "parentId": "n2"
   },
   {
    "id": "n5",
    "title": "Building a network",
    "description": "Networking and industry relationships",
    "parentId": "n1"
   },
   {
    "id": "n6",
    "title": "Attending conferences",
    "description": "2 conferences per year",
    "parentId": "n5"
   },
   {
    "id": "n7",
    "title": "LinkedIn activity",
    "description": "Regular posts and comments",
    "parentId": "n5"
   },
   {
    "id": "n8",
    "title": "Leading projects",
    "description": "Take responsibility for key projects",
    "parentId": "n1"
   },
   {
    "id": "n9",
    "title": "Lead a team",
    "description": "Mentoring junior colleagues",
    "parentId": "n8"
   }
  ]
 },
 {
  "title": "Finanční nezávislost",
  "title_en": "Financial Independence",
  "description_en": "The path to financial stability and freedom through saving and investing.",
  "goal_en": "Achieve financial independence",
  "ai_nodes_en": [
   {
    "id": "n1",
    "title": "Achieve financial independence",
    "description": "Long-term vision of financial freedom",
    "parentId": null
   },
   {
    "id": "n2",
    "title": "Reducing debt",
    "description": "Gradually paying off all loans",
    "parentId": "n1"
   },
   {
    "id": "n3",
    "title": "Paying off consumer loans",
    "description": "Pay off expensive loans first",
    "parentId": "n2"
   },
   {
    "id": "n4",
    "title": "Building an emergency fund",
    "description": "Save six months' worth of expenses",
    "parentId": "n1"
   },
   {
    "id": "n5",
    "title": "Regular savings",
    "description": "Automatically set aside 10% of income",
    "parentId": "n4"
   },
   {
    "id": "n6",
    "title": "Investing",
    "description": "Long-term building of an investment portfolio",
    "parentId": "n1"
   },
   {
    "id": "n7",
    "title": "ETF portfolio",
    "description": "Monthly investments in diversified ETFs",
    "parentId": "n6"
   },
   {
    "id": "n8",
    "title": "Additional income",
    "description": "Create a source of passive income",
    "parentId": "n1"
   },
   {
    "id": "n9",
    "title": "Financial education",
    "description": "Books and courses on investing",
    "parentId": "n1"
   }
  ]
 },
 {
  "title": "Zdravý životní styl",
  "title_en": "Healthy Lifestyle",
  "description_en": "A comprehensive plan for physical and mental well-being and long-term health.",
  "goal_en": "Live a healthy and balanced life",
  "ai_nodes_en": [
   {
    "id": "n1",
    "title": "Live a healthy and balanced life",
    "description": "The overall mission of a healthy lifestyle",
    "parentId": null
   },
   {
    "id": "n2",
    "title": "Regular exercise",
    "description": "Physical activity at least 3x a week",
    "parentId": "n1"
   },
   {
    "id": "n3",
    "title": "Strength training",
    "description": "Weight training 2x a week",
    "parentId": "n2"
   },
   {
    "id": "n4",
    "title": "Cardio",
    "description": "Running or cycling 1x a week",
    "parentId": "n2"
   },
   {
    "id": "n5",
    "title": "Balanced diet",
    "description": "Meal planning and healthy choices",
    "parentId": "n1"
   },
   {
    "id": "n6",
    "title": "Meal preparation",
    "description": "Meal prep 2x a week",
    "parentId": "n5"
   },
   {
    "id": "n7",
    "title": "Hydration",
    "description": "2–3 liters of water daily",
    "parentId": "n5"
   },
   {
    "id": "n8",
    "title": "Quality sleep",
    "description": "7–8 hours of sleep and a regular schedule",
    "parentId": "n1"
   },
   {
    "id": "n9",
    "title": "Digital detox",
    "description": "No screens 1 hour before bed",
    "parentId": "n8"
   }
  ]
 },
 {
  "title": "Budování startupu",
  "title_en": "Building a Startup",
  "description_en": "A strategy to launch and grow your own business — from idea to product.",
  "goal_en": "Build a successful startup",
  "ai_nodes_en": [
   {
    "id": "n1",
    "title": "Build a successful startup",
    "description": "The overarching strategy for building the business",
    "parentId": null
   },
   {
    "id": "n2",
    "title": "Idea validation",
    "description": "Verify the market potential",
    "parentId": "n1"
   },
   {
    "id": "n3",
    "title": "Market research",
    "description": "Analyze the competition and target audience",
    "parentId": "n2"
   },
   {
    "id": "n4",
    "title": "Customer interviews",
    "description": "30 interviews with potential users",
    "parentId": "n2"
   },
   {
    "id": "n5",
    "title": "MVP development",
    "description": "Build the minimum viable product",
    "parentId": "n1"
   },
   {
    "id": "n6",
    "title": "Prototype",
    "description": "A working prototype for testing",
    "parentId": "n5"
   },
   {
    "id": "n7",
    "title": "Beta testing",
    "description": "Testing with 50 users",
    "parentId": "n5"
   },
   {
    "id": "n8",
    "title": "Customer acquisition",
    "description": "A strategy for the first paying customers",
    "parentId": "n1"
   },
   {
    "id": "n9",
    "title": "Marketing",
    "description": "Content marketing and social media",
    "parentId": "n8"
   },
   {
    "id": "n10",
    "title": "Partnerships",
    "description": "Team up with complementary services",
    "parentId": "n8"
   }
  ]
 },
 {
  "title": "Úspěšné studium",
  "title_en": "Successful Studies",
  "description_en": "A plan for effective learning, good grades and developing academic skills.",
  "goal_en": "Successfully graduate with honors",
  "ai_nodes_en": [
   {
    "id": "n1",
    "title": "Successfully graduate with honors",
    "description": "Main academic goal",
    "parentId": null
   },
   {
    "id": "n2",
    "title": "Effective learning",
    "description": "Establishing study methods and techniques",
    "parentId": "n1"
   },
   {
    "id": "n3",
    "title": "Time management",
    "description": "Weekly study plan",
    "parentId": "n2"
   },
   {
    "id": "n4",
    "title": "Active recall",
    "description": "Spaced repetition and flashcards",
    "parentId": "n2"
   },
   {
    "id": "n5",
    "title": "Working on term papers",
    "description": "Steady, high-quality progress",
    "parentId": "n1"
   },
   {
    "id": "n6",
    "title": "Early submission",
    "description": "Submitting 2 days before the deadline",
    "parentId": "n5"
   },
   {
    "id": "n7",
    "title": "Exam preparation",
    "description": "Systematic preparation in advance",
    "parentId": "n1"
   },
   {
    "id": "n8",
    "title": "Study group",
    "description": "Regular meetings with classmates",
    "parentId": "n7"
   },
   {
    "id": "n9",
    "title": "Work experience and internships",
    "description": "Gaining industry experience during studies",
    "parentId": "n1"
   }
  ]
 },
 {
  "title": "Work-life balance",
  "title_en": "Work-Life Balance",
  "description_en": "Find a healthy balance between work, rest and relationships.",
  "goal_en": "Find a healthy balance between work and personal life",
  "ai_nodes_en": [
   {
    "id": "root",
    "title": "Find a healthy balance between work and personal life",
    "description": "Improve the balance between work and personal time",
    "parentId": null
   },
   {
    "id": "f1",
    "title": "Time management and boundaries",
    "description": "Establishing clear time rules and limiting workload",
    "parentId": "root"
   },
   {
    "id": "f1a1",
    "title": "Assess your current time allocation",
    "description": "Track how much time you spend on work, leisure, and other activities",
    "parentId": "f1"
   },
   {
    "id": "f1a2",
    "title": "Set fixed working hours and time off",
    "description": "Define and stick to specific working hours and free time",
    "parentId": "f1"
   },
   {
    "id": "f1a3",
    "title": "Implement time blocking",
    "description": "Use a calendar to reserve blocks for work and personal activities",
    "parentId": "f1"
   },
   {
    "id": "f2",
    "title": "Physical and mental health",
    "description": "Supporting physical well-being and mental balance",
    "parentId": "root"
   },
   {
    "id": "f2a1",
    "title": "Create a regular exercise routine",
    "description": "Include at least 30 minutes of exercise in your weekly plan",
    "parentId": "f2"
   },
   {
    "id": "f2a2",
    "title": "Get enough sleep",
    "description": "Set a regular sleep schedule and stick to 7–8 hours of sleep",
    "parentId": "f2"
   },
   {
    "id": "f2a3",
    "title": "Practice relaxation techniques",
    "description": "Practice mindfulness or breathing exercises for at least 10 minutes a day",
    "parentId": "f2"
   },
   {
    "id": "f3",
    "title": "Personal relationships and growth",
    "description": "Developing your personal life and interpersonal relationships",
    "parentId": "root"
   },
   {
    "id": "f3a1",
    "title": "Define priorities in your personal life",
    "description": "Determine what matters most outside of work (family, friends, hobbies)",
    "parentId": "f3"
   },
   {
    "id": "f3a2",
    "title": "Schedule regular time for family and friends",
    "description": "Reserve specific days or hours each week for shared activities",
    "parentId": "f3"
   },
   {
    "id": "f3a3",
    "title": "Build hobbies into your daily routine",
    "description": "Set aside time for favorite hobbies and creative activities",
    "parentId": "f3"
   }
  ]
 }
];
  for (const d of DATA) {
    try {
      const rec = app.findFirstRecordByFilter("templates", "title = {:t} && owner = ''", { t: d.title });
      rec.set("title_en", d.title_en);
      rec.set("description_en", d.description_en);
      rec.set("goal_en", d.goal_en);
      rec.set("ai_nodes_en", d.ai_nodes_en);
      app.save(rec);
    } catch (err) { /* šablona v této instanci není — přeskočit */ }
  }
}, (app) => { /* jen textové korekce dat — návrat není potřeba */ });

// PUBLIC case information only (titles and the opening briefing everyone sees).
// Private scripts, evidence and the solution live in the database, never here.
window.FLD_CASES = {
  case001: {
    id: 'case001',
    available: true,
    title: 'The Missing Million',
    genre: 'Theft and financial deception',
    minPlayers: 5,
    maxPlayers: 10,
    description: 'A birthday dinner in Abuja. A locked study. An envelope of cash that vanished.',
    briefing: [
      'Tonight is Chief Tunde Adewale’s 60th birthday dinner at his residence in Maitama, Abuja.',
      'At 7:30 PM his banker delivered a sealed envelope containing ₦1,000,000 in cash, set aside for a surprise presentation later in the evening. At 7:42 PM the Chief locked it in the desk drawer of his study and locked the study door.',
      'At 10:05 PM he unlocked the study to fetch it. The drawer was empty.',
      'The study door uses key cards and records each use. The Chief believes four cards exist: his own, his PA’s, a security master card, and a spare kept in a locked cabinet in the service corridor.',
      'The compound gate has been shut since the discovery. Nobody has left. The thief is still among you.',
      'Detective Chioma Nwosu, an off-duty police detective and old friend of the Chief, is leading the inquiry.',
      'One of you took the money. Everyone else must help find them, or protect their own secrets.'
    ]
  },
  case002: { id: 'case002', available: false, title: 'Murder at Midnight', description: 'Coming soon.' },
  case003: { id: 'case003', available: false, title: 'The Betrayal', description: 'Coming soon.' },
  case004: { id: 'case004', available: false, title: 'The Last Witness', description: 'Coming soon.' },
  case005: { id: 'case005', available: false, title: 'The Perfect Alibi', description: 'Coming soon.' }
};

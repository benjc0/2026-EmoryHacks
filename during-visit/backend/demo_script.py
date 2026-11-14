"""Scripted demo visits.

Used by the "Demo" button: streams pre-written captions (no mic, no Live API) so you
can test the UI, note extraction and reminders anywhere, and as a backup for judging.

Each line: (seconds to wait before it, speaker, what they say, translation into the other language)
The script is picked by the patient's language on the start screen (see pick_demo()).
"""

# ------------------------------------------------------------------ Korean
# Interpreter story: English-speaking doctor, Korean-speaking parent, child's knee injury.
DEMO_KO = [
    (1.0, "doctor", "Hi, I'm Dr. Lee. What brings you in today?",
     "안녕하세요, 저는 이 박사입니다. 오늘 어떻게 오셨어요?"),
    (3.0, "patient", "제 아들 무릎이 3주 동안 아팠어요. 축구하다가 다쳤어요.",
     "My son's knee has hurt for three weeks. He hurt it playing soccer."),
    (3.5, "doctor", "Okay. From the exam this looks like patellar tendinitis, an irritated tendon below the kneecap. Nothing is torn.",
     "네. 검사해 보니 슬개건염으로 보입니다. 무릎뼈 아래 힘줄에 염증이 생긴 거예요. 찢어진 곳은 없습니다."),
    (4.0, "doctor", "I'm prescribing meloxicam, 7.5 milligrams, once a day with food, for two weeks.",
     "멜록시캄 7.5밀리그램을 하루 한 번, 음식과 함께, 2주 동안 처방하겠습니다."),
    (4.0, "doctor", "He should also do quad sets: tighten the thigh muscle with the leg straight, hold five seconds. Three sets of ten, twice a day. Keep the knee flat on the bed.",
     "대퇴사두근 운동도 해야 합니다. 다리를 곧게 펴고 허벅지 근육에 힘을 주고 5초 동안 유지하세요. 10회씩 3세트, 하루 두 번. 무릎은 침대에 평평하게 두세요."),
    (4.0, "patient", "축구는 언제 다시 할 수 있어요?",
     "When can he play soccer again?"),
    (3.0, "doctor", "No soccer or jumping for four weeks. Then we'll see him again for a follow-up.",
     "4주 동안 축구나 점프는 하지 마세요. 그 후에 다시 진료를 보겠습니다."),
    (3.5, "doctor", "If the knee gets very swollen, red, or he can't put weight on it, come in right away.",
     "무릎이 많이 붓거나, 빨갛게 되거나, 체중을 실을 수 없으면 바로 오세요."),
    (3.0, "doctor", "Okay, I think that covers everything. Any other questions before you go?",
     "네, 다 설명드린 것 같아요. 가시기 전에 다른 질문 있으세요?"),
]

DEMO_QUESTIONS_KO = [
    "이 약에 부작용이 있나요?",           # Does this medicine have side effects?
    "언제 다시 축구를 할 수 있나요?",       # When can he play soccer again?
    "얼음찜질을 해야 하나요?",             # Should we ice it?
]

# ------------------------------------------------------------------ English
# Accessibility story: English-only visit for a hard-of-hearing older patient.
# The app works as live captions + notes + question reminders (no translation needed).
# Heart follow-up: blood pressure + new atrial fibrillation -> blood thinner.
_EN = [
    (1.0, "doctor", "Good morning, Mr. Johnson. I'm Dr. Patel. How have you been feeling since your last visit?"),
    (3.0, "patient", "Mostly okay. But my heart sometimes flutters, and I get tired walking up the stairs."),
    (3.5, "doctor", "Your monitor results came back. The fluttering is atrial fibrillation. It's an irregular heartbeat, and it raises the risk of stroke."),
    (4.0, "patient", "A stroke? That sounds serious."),
    (3.5, "doctor", "It's very manageable. I'm starting you on apixaban, a blood thinner. Five milligrams, twice a day, morning and evening. Don't skip doses."),
    (4.0, "doctor", "Your blood pressure is also high today, 152 over 94. I'm increasing your lisinopril from 10 milligrams to 20 milligrams, once a day."),
    (4.0, "doctor", "Please stop taking ibuprofen or Advil. With the blood thinner, it raises your bleeding risk. Use Tylenol for pain instead."),
    (4.0, "doctor", "I'd like you to walk thirty minutes a day, five days a week, at a pace where you can still talk. And check your blood pressure at home every morning and write it down."),
    (4.0, "doctor", "We'll do a blood test in one week to check your kidneys after the dose change, and I'll see you back here in three months."),
    (3.5, "doctor", "Call us right away if you notice black stools, blood in your urine, or bruising that won't stop. And call 911 if you have face drooping, arm weakness, or trouble speaking."),
    (3.0, "doctor", "Alright, I think that's everything for today. Do you have any other questions before you go?"),
]
DEMO_EN = [(d, who, text, text) for d, who, text in _EN]   # same language: no translation

DEMO_QUESTIONS_EN = [
    "Can I still have a glass of wine with dinner?",
    "Do I need to stop taking ibuprofen?",          # answered in the script
    "Is it safe for me to drive?",
    "Will the new medicine make me dizzy?",
]

# ------------------------------------------------------------------ Physical therapy (Korean)
# PT story: English-speaking physical therapist, Korean-speaking grandmother,
# 2 weeks after a LEFT total knee replacement. Produces a full home workout plan.
DEMO_PT = [
    (1.0, "doctor", "Hi Mrs. Kim, I'm Sarah, your physical therapist. How is your left knee two weeks after surgery?",
     "안녕하세요 김 여사님, 저는 물리치료사 사라입니다. 수술 2주 후 왼쪽 무릎은 어떠세요?"),
    (3.5, "patient", "아직 아프고 많이 안 굽혀져요. 계단이 무서워요.",
     "It still hurts and it doesn't bend much. I'm scared of the stairs."),
    (3.5, "doctor", "That's normal at two weeks. Today your knee bends to 80 degrees. Our goal is 110 degrees in six weeks.",
     "2주째에는 정상이에요. 오늘 무릎이 80도까지 굽혀져요. 목표는 6주 안에 110도입니다."),
    (4.0, "doctor", "First exercise: seated knee extensions. Sit in a chair, straighten your left knee slowly, and hold it straight for 2 seconds at the top. 2 sets of 10, three times a day.",
     "첫 번째 운동은 앉아서 무릎 펴기예요. 의자에 앉아서 왼쪽 무릎을 천천히 펴고, 끝까지 편 상태로 2초 동안 유지하세요. 10회씩 2세트, 하루 세 번이요."),
    (4.5, "doctor", "Second: mini squats. Stand holding the kitchen counter and bend both knees a little, like you're starting to sit down. 2 sets of 8, twice a day. Keep your chest up.",
     "두 번째는 미니 스쿼트예요. 부엌 조리대를 잡고 서서, 앉으려는 것처럼 양쪽 무릎을 살짝 굽히세요. 8회씩 2세트, 하루 두 번이요. 가슴을 펴세요."),
    (3.5, "patient", "운동할 때 아프면 어떻게 해요?",
     "What should I do if it hurts while exercising?"),
    (4.0, "doctor", "Some discomfort is okay. If the pain goes above 5 out of 10, stop and rest. Put ice on the knee for 15 minutes after exercising.",
     "약간 불편한 건 괜찮아요. 통증이 10점 중 5점을 넘으면 멈추고 쉬세요. 운동 후에는 무릎에 15분 동안 얼음찜질을 하세요."),
    (4.0, "doctor", "For the next two weeks, don't kneel, and don't bend your knees more than 60 degrees during the squats.",
     "앞으로 2주 동안은 무릎을 꿇지 마시고, 스쿼트할 때 무릎을 60도 넘게 굽히지 마세요."),
    (3.5, "doctor", "Also walk with your walker for 10 minutes, three times a day.",
     "그리고 보행기를 사용해서 하루 세 번, 10분씩 걸으세요."),
    (4.0, "doctor", "Call us right away if the knee gets hot and red, or if your calf is painful or swollen. That could be a blood clot.",
     "무릎이 뜨겁고 빨개지거나, 종아리가 아프거나 부으면 바로 연락하세요. 혈전일 수 있어요."),
    (3.5, "doctor", "I'll see you here twice a week for the next six weeks. Any other questions before you go?",
     "앞으로 6주 동안 일주일에 두 번 여기서 뵐게요. 가시기 전에 다른 질문 있으세요?"),
]

DEMO_QUESTIONS_PT = [
    "계단은 어떻게 올라가야 해요?",          # How should I go up stairs?  (never answered -> reminder)
    "얼음찜질을 해도 돼요?",                 # Can I use ice?               (answered)
    "운동은 하루에 몇 번 해야 해요?",         # How many times a day?        (answered)
]

# ------------------------------------------------------------------ picking
# Scenario name -> (script, sample questions, doctor language, patient language)
SCENARIOS = {
    "knee":  (DEMO_KO, DEMO_QUESTIONS_KO, "en", "ko"),   # interpreter: sports knee injury
    "heart": (DEMO_EN, DEMO_QUESTIONS_EN, "en", "en"),   # captions: hard-of-hearing heart patient
    "pt":    (DEMO_PT, DEMO_QUESTIONS_PT, "en", "ko"),   # physical therapy -> workout plan
}
DEMOS = {"ko": (DEMO_KO, DEMO_QUESTIONS_KO), "en": (DEMO_EN, DEMO_QUESTIONS_EN)}


def pick_demo(patient_lang: str, scenario: str | None = None):
    """Pick by scenario if given; otherwise English patient -> heart demo, anything else -> knee demo."""
    if scenario in SCENARIOS:
        script, questions, _, _ = SCENARIOS[scenario]
        return script, questions
    return DEMOS.get(patient_lang, DEMOS["ko"])


# Backwards-compatible names
DEMO, DEMO_QUESTIONS = DEMO_KO, DEMO_QUESTIONS_KO
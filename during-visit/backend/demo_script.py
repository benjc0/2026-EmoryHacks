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

# ------------------------------------------------------------------ picking
DEMOS = {"ko": (DEMO_KO, DEMO_QUESTIONS_KO), "en": (DEMO_EN, DEMO_QUESTIONS_EN)}


def pick_demo(patient_lang: str):
    """English patient -> English captions demo; anything else -> Korean interpreter demo."""
    return DEMOS.get(patient_lang, DEMOS["ko"])


# Backwards-compatible names
DEMO, DEMO_QUESTIONS = DEMO_KO, DEMO_QUESTIONS_KO
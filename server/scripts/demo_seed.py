"""Insert one finished video so the reader UI can be reviewed without API spend.

Run from the server directory:  .venv\\Scripts\\python.exe scripts\\demo_seed.py
Delete it from the app (or run with --remove) when you are done looking.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import db  # noqa: E402

YID = "DxL2HoqLbyA"

SEGMENTS = [
    "Entropy is the one idea in physics that everyone has heard of and almost nobody has understood.",
    "The word gets used to mean disorder, or mess, or the slow decay of everything you love.",
    "Boltzmann's insight was that entropy is not about mess at all. It is about counting.",
    "Take a box of gas. Every way you could arrange the molecules is a microstate.",
    "The number of arrangements that look the same from outside is what we call the multiplicity.",
    "And entropy is just the logarithm of that number, multiplied by a constant.",
    "So S equals k B times the natural log of W, where W is the number of microscopic arrangements.",
    "When W is small, the system has few ways to be. When W is large, it has many.",
    "Nothing in the microscopic laws prefers large W. The laws work the same in both directions.",
    "But there are simply far more ways to be mixed than to be sorted.",
    "That is the whole content of the second law. It is not a force pushing things toward disorder.",
    "It is counting. A shuffled deck is not more likely because shuffling is powerful, but because most orders look shuffled.",
    "This is why a broken egg does not reassemble. Not because the rules forbid it, but because the reassembled state is one arrangement among an absurd number.",
    "Now the part that surprises people. Entropy can decrease locally, and does, all the time.",
    "Your fridge does exactly that. It pushes heat out of the cold compartment and dumps it into the room.",
    "It pays for that with work, and the total entropy of the room plus the fridge still goes up.",
    "Life does the same thing. A cell is extraordinarily ordered, and it stays that way by exporting entropy.",
    "The accounting always balances. That is why entropy is better read as a budget than as a verdict.",
    "None of this says the universe is dying in any way you will notice.",
    "It says that every rearrangement you make costs a little more than it returns, and the ledger is never wrong.",
]

MOMENTS = [
    (3, "Entropy is counting, not mess",
     "Boltzmann's move was to stop describing arrangements and start counting them.",
     "Boltzmann's insight was that entropy is not about mess at all. It is about the counting."),
    (10, "The second law is arithmetic",
     "There are more ways to be mixed than sorted, so mixing is what happens.",
     "But there are simply far more ways to be mixed than to be sorted."),
    (13, "Local order is allowed",
     "A fridge lowers entropy in one place by raising it somewhere else.",
     "Entropy can decrease locally, and does, all the time."),
]

TAKEAWAYS = [
    ("formula", "Entropy counts the microscopic arrangements consistent with what you can see.",
     "S = k_B \\ln W", 6),
    ("claim", "The second law is a statement about probability, not a force.",
     None, 10),
    ("number", "One shuffled deck has about 8 × 10^67 orderings; the sorted one is a single one of them.",
     None, 11),
    ("definition", "A microstate is one specific arrangement of the parts; a macrostate is everything that looks the same from outside.",
     None, 4),
    ("claim", "Order is not forbidden, it is paid for. Fridges and cells both export entropy.",
     None, 16),
]

SUMMARY = (
    "Entropy is usually described as disorder, and that description hides what it actually is: a count. "
    "Boltzmann showed that any arrangement of a system's parts is a microstate, and the number of microstates "
    "that look identical from outside is its multiplicity. Entropy is the logarithm of that number, which is why "
    "it grows whenever a system moves to a state with more ways to be.\n\n"
    "The second law follows from arithmetic rather than force. Nothing in the microscopic rules prefers mixing; "
    "there are simply vastly more mixed arrangements than sorted ones, the same reason a shuffled deck looks "
    "shuffled. A broken egg stays broken for that reason, not because the rules forbid reassembly.\n\n"
    "Local order is entirely allowed. A fridge lowers entropy in one compartment by pumping heat into the room, "
    "and a living cell stays organised by exporting entropy outward. The total never goes down, which makes "
    "entropy a budget rather than a verdict."
)


def main() -> None:
    if "--remove" in sys.argv:
        with db.db() as con:
            row = con.execute("SELECT id FROM videos WHERE youtube_id = ?", (YID,)).fetchone()
            if row:
                for table, column in (("segments", "video_id"), ("moments", "video_id"),
                                      ("takeaways", "video_id"), ("videos", "id")):
                    con.execute(f"DELETE FROM {table} WHERE {column} = ?", (row["id"],))
        print("removed")
        return

    db.init()
    existing, _created = db.claim_video(YID, f"https://www.youtube.com/watch?v={YID}")
    vid = existing["id"]
    db.replace_segments(vid, [
        {"idx": i, "start_ms": i * 95_000, "end_ms": i * 95_000 + 92_000, "text": text}
        for i, text in enumerate(SEGMENTS)
    ])
    db.replace_moments(vid, [
        {"segment_idx": idx, "start_ms": idx * 95_000, "title": title, "note": note, "quote": quote}
        for idx, title, note, quote in MOMENTS
    ])
    db.replace_takeaways(vid, [
        {"segment_idx": idx, "start_ms": idx * 95_000, "kind": kind, "text": text, "latex": latex,
         "quote": None}
        for kind, text, latex, idx in TAKEAWAYS
    ])
    db.save_meta(vid, title="Why entropy is really about counting",
                 channel="Veritasium", duration_s=2500, language="english",
                 fetch_tier="audio", category="education", category_confidence=0.94,
                 gist="Order is not forbidden, it is paid for — and the price is counted, not enforced.",
                 summary=SUMMARY, summary_lang="english")
    db.set_status(vid, "ready", "done", 1.0)
    print(vid)


if __name__ == "__main__":
    main()

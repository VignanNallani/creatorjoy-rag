import sys
import json
import re
import urllib.request
import yt_dlp

def clean_vtt(vtt_text):
    if not vtt_text:
        return ""
    # Remove WEBVTT header
    vtt_text = re.sub(r'^WEBVTT\s*\n*', '', vtt_text, flags=re.IGNORECASE)
    # Remove timestamps and lines like: 00:00:00.000 --> 00:00:02.000
    vtt_text = re.sub(r'\d{2}:\d{2}:\d{2}\.\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}\.\d{3}.*\n', '', vtt_text)
    # Remove styling/cue settings e.g. <c> or </c>
    vtt_text = re.sub(r'<[^>]*>', '', vtt_text)
    # Join lines and remove duplicate whitespace
    lines = [line.strip() for line in vtt_text.split('\n') if line.strip()]
    # Remove consecutive duplicate lines (common in VTT files representing scroll subtitles)
    cleaned_lines = []
    for line in lines:
        if not cleaned_lines or cleaned_lines[-1] != line:
            cleaned_lines.append(line)
    return " ".join(cleaned_lines)

def fetch_subtitle_text(subtitles_dict):
    if not subtitles_dict:
        return ""
    # Try English ('en') first, then any language available
    langs = ['en'] + [k for k in subtitles_dict.keys() if k != 'en']
    for lang in langs:
        if lang in subtitles_dict:
            formats = subtitles_dict[lang]
            # Try to prioritize json3 first (easier to parse), then vtt
            for fmt in sorted(formats, key=lambda f: 0 if f.get('ext') == 'json3' else (1 if f.get('ext') == 'vtt' else 2)):
                url = fmt.get('url')
                if url:
                    try:
                        req = urllib.request.Request(
                            url, 
                            headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
                        )
                        with urllib.request.urlopen(req, timeout=5) as response:
                            content = response.read().decode('utf-8')
                        
                        if fmt.get('ext') == 'json3':
                            data = json.loads(content)
                            events = data.get('events', [])
                            texts = []
                            for ev in events:
                                segs = ev.get('segs', [])
                                for s in segs:
                                    t = s.get('utf8')
                                    if t and t.strip():
                                        texts.append(t.strip())
                            return " ".join(texts)
                        else:
                            return clean_vtt(content)
                    except Exception:
                        continue
    return ""

def main():
    if len(sys.argv) < 2:
        print(json.dumps({
            "error": "Missing Instagram Reel URL argument",
            "title": None,
            "view_count": 0,
            "like_count": 0,
            "comment_count": 0,
            "channel": None,
            "subscriber_count": None,
            "subscriber_count_note": "Missing argument",
            "tags": [],
            "upload_date": None,
            "duration": 0,
            "engagement_rate": 0.0,
            "transcript": ""
        }))
        sys.exit(1)

    url = sys.argv[1]
    
    # Initialize default result structure
    result = {
        "title": None,
        "view_count": 0,
        "like_count": 0,
        "comment_count": 0,
        "channel": None,
        "subscriber_count": None,
        "subscriber_count_note": None,
        "tags": [],
        "upload_date": None,
        "duration": 0,
        "engagement_rate": 0.0,
        "transcript": ""
    }

    # Use yt-dlp to extract metadata and requested subtitles
    ydl_opts = {
        'skip_download': True,
        'quiet': True,
        'no_warnings': True,
        'writesubtitles': True,
        'writeautomaticsub': True,
    }

    import os
    cookie_file = os.path.join(os.path.dirname(__file__), 'instagram_cookies.txt')
    if os.path.exists(cookie_file):
        ydl_opts['cookiefile'] = cookie_file

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            
            if info:
                # Populate basic metadata
                result["title"] = info.get("title")
                # Instagram specific uploader/channel name
                result["channel"] = info.get("uploader") or info.get("channel") or info.get("user")
                
                # Integer parsing helpers
                def to_int(val):
                    if val is None:
                        return 0
                    try:
                        return int(val)
                    except (ValueError, TypeError):
                        return 0

                result["view_count"] = to_int(info.get("view_count"))
                result["like_count"] = to_int(info.get("like_count"))
                result["comment_count"] = to_int(info.get("comment_count"))
                result["duration"] = to_int(info.get("duration"))
                
                # Tags & upload date
                tags = info.get("tags")
                result["tags"] = tags if isinstance(tags, list) else []
                result["upload_date"] = info.get("upload_date")

                # Follower/subscriber count extraction
                follower_count = info.get("channel_follower_count")
                if follower_count is None:
                    # check other possible keys
                    follower_count = info.get("subscriber_count")

                if follower_count is not None:
                    result["subscriber_count"] = to_int(follower_count)
                else:
                    result["subscriber_count"] = None
                    result["subscriber_count_note"] = "channel_follower_count not available from yt-dlp metadata for Instagram Reels"

                # Calculate engagement rate: (like_count + comment_count) / view_count * 100
                views = result["view_count"]
                likes = result["like_count"]
                comments = result["comment_count"]
                if views > 0:
                    result["engagement_rate"] = round(((likes + comments) / views) * 100, 4)
                else:
                    result["engagement_rate"] = 0.0

                # Extract transcripts / subtitles using writesubtitles info
                subtitles_info = info.get("subtitles") or info.get("automatic_captions")
                if subtitles_info:
                    result["transcript"] = fetch_subtitle_text(subtitles_info)
                else:
                    result["transcript"] = ""

    except Exception as e:
        result["error"] = f"Extraction failed: {str(e)}"
        result["subscriber_count_note"] = "Extraction failed"

    # Print final result as a single JSON object to stdout
    print(json.dumps(result))

if __name__ == '__main__':
    main()

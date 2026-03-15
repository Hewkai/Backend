import os
from dotenv import load_dotenv
from flask import Flask, request, jsonify
from flask_cors import CORS
import mysql.connector
import torch
from transformers import AutoTokenizer, AutoModelForSequenceClassification
from neo4j import GraphDatabase

# โหลดค่าจากไฟล์ .env
load_dotenv()

app = Flask(__name__)
# อนุญาต CORS ทุกกรณีเพื่อป้องกันปัญหาการเชื่อมต่อ
CORS(app)

# ==========================================
# 1. CONFIGURATION
# ==========================================

# Database MySQL
MYSQL_CONFIG = {
    'host': os.getenv('MYSQL_HOST', 'localhost'),
    'user': os.getenv('MYSQL_USER', 'root'),
    'password': os.getenv('MYSQL_PASSWORD', ''),      
    'database': os.getenv('MYSQL_DATABASE', 'cookies_db')
}

# Neo4j Aura Config (Cloud) 
NEO4J_URI = os.getenv('NEO4J_URI')
NEO4J_USER = os.getenv('NEO4J_USER')
NEO4J_PASSWORD = os.getenv('NEO4J_PASSWORD')

# Initialize Neo4j Driver
driver = None
try:
    if NEO4J_URI and NEO4J_USER and NEO4J_PASSWORD:
        driver = GraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASSWORD))
        driver.verify_connectivity()
        print("[SYSTEM] Neo4j Aura Connected Successfully!")
    else:
        print("[ERROR] Neo4j Config is missing from .env file!")
except Exception as e:
    print(f"[ERROR] Neo4j Connection Failed: {e}")

# ==========================================
# 2. AI MODEL LOADING 
# ==========================================
print("[SYSTEM] Loading AI Models...")
HF_MODEL_DIR = './hf_cookie_model_balanced' 

try:
    tokenizer = AutoTokenizer.from_pretrained(HF_MODEL_DIR)
    model = AutoModelForSequenceClassification.from_pretrained(HF_MODEL_DIR)
    
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model.to(device).eval()
    
    ID2LABEL = model.config.id2label
    print(f"[SYSTEM] AI Model (Balanced) Loaded Successfully on {device}!")

except Exception as e:
    print(f"[ERROR] Loading Model: {e}")
    ID2LABEL = {0: "Unknown"}

# ==========================================
# 3. NEO4J FUNCTION (UPDATED FOR MULTI-USER)
# ==========================================

def push_to_neo4j(user_id, source_site, tracker_domain, label):
    if not user_id or not tracker_domain: return
    if not source_site or source_site == "Unknown": source_site = "Unknown_Source"
    
    # แก้ชื่อ Extension ยาวๆ
    if len(source_site) == 32 and "." not in source_site:
        source_site = "Browser Extension"

    if source_site == tracker_domain: return

    print(f"[DEBUG] Graph Plotting for {user_id}: {source_site} -> {tracker_domain} ({label})")

    if driver:
        try:
            with driver.session() as session:
                # แก้ไข Query ให้เชื่อมโยงข้อมูลเข้ากับ User Node เฉพาะบุคคล
                query = """
                MERGE (u:User {id: $u_id})
                MERGE (s:Website {name: $site})
                MERGE (t:Tracker {name: $tracker})
                MERGE (u)-[:OWNS_HISTORY]->(s)
                MERGE (s)-[r:SENDS_DATA_TO]->(t)
                SET r.type = $cookie_type, r.last_seen = datetime()
                """
                session.run(query, u_id=user_id, site=source_site, tracker=tracker_domain, cookie_type=label)    
            print(f"[SUCCESS] Graph Updated for User: {user_id}")
        except Exception as e:
            print(f"[ERROR] Neo4j Error: {e}")

# ==========================================
# 4. API ROUTES 
# ==========================================

@app.route('/', methods=['GET'])
def home():
    return "CookiesChecker API is Running with Multi-User Support!"

@app.route('/predict', methods=['POST'])
def predict():
    try:
        data = request.json
        user_id = data.get('user_id') # รับ user_id จาก Extension
        name = data.get('name', '').strip()
        domain = data.get('domain', '').strip()
        source_site = data.get('source_site', 'Unknown_Source') 
        
        if not domain:
            domain = "Unknown_Domain"

        if not user_id:
            return jsonify({"error": "Missing user_id"}), 400

        conn = mysql.connector.connect(**MYSQL_CONFIG)
        cursor = conn.cursor(dictionary=True)
        
        # 1. เช็คใน Database MySQL
        cursor.execute("SELECT label FROM cookies WHERE name=%s AND domain=%s LIMIT 1", (name, domain))
        result = cursor.fetchone()

        label = "Unknown"
        source = "ai_model"

        if result and result['label'] and result['label'] != 'Unknown':
            label = result['label']
            source = "database"
        else:
            # 2. ถ้าไม่มีให้ AI ทำนาย
            try:
                text = f"cookie_name={name}; domain={domain}"
                inputs = tokenizer(text, return_tensors="pt", truncation=True, padding=True, max_length=64).to(device)
                
                with torch.no_grad():
                    outputs = model(**inputs)
                    pred_id = torch.argmax(outputs.logits, dim=-1).item()
                    label = ID2LABEL.get(pred_id, "Unknown")
            except Exception as e:
                print(f"[ERROR] AI Prediction Failed: {e}")
                label = "Unknown"

            # บันทึกลง MySQL
            sql = "INSERT INTO cookies (name, domain, label, label_source) VALUES (%s, %s, %s, 'ai_predicted') ON DUPLICATE KEY UPDATE label=%s"
            cursor.execute(sql, (name, domain, label, label))
            conn.commit()
        
        conn.close()

        # 3. ส่งข้อมูลไป Neo4j โดยระบุ user_id
        push_to_neo4j(user_id, source_site, domain, label)

        return jsonify({"source": source, "label": label})

    except Exception as e:
        print(f"[ERROR] Server Error: {e}")
        return jsonify({"source": "error", "label": "Unknown"})

@app.route('/graph-data', methods=['GET'])
def get_graph_data():
    user_id = request.args.get('user_id') # รับ user_id เพื่อกรองข้อมูล
    site = request.args.get('site')       # รับชื่อเว็บไซต์จากหน้าบ้าน (ถ้ามี)
    
    nodes = []
    edges = []
    node_ids = set()

    if not user_id:
        return jsonify({"nodes": [], "edges": []})

    try:
        if driver:
            with driver.session() as session:
                # ถ้ามีการส่ง site มา ให้กรองดูกราฟเฉพาะเว็บนั้น
                if site:
                    query = """
                    MATCH (u:User {id: $u_id})-[:OWNS_HISTORY]->(n:Website)-[r:SENDS_DATA_TO]->(m:Tracker)
                    WHERE n.name CONTAINS $site
                    RETURN n, r, m
                    """
                    result = session.run(query, u_id=user_id, site=site)
                
                # ถ้าไม่มีการส่ง site มา (เช่น เปิดจาก New Tab) ให้ดึงแค่ 200 รายการล่าสุดเพื่อลดอาการกระตุก
                else:
                    query = """
                    MATCH (u:User {id: $u_id})-[:OWNS_HISTORY]->(n:Website)-[r:SENDS_DATA_TO]->(m:Tracker)
                    RETURN n, r, m
                    ORDER BY r.last_seen DESC
                    LIMIT 200
                    """
                    result = session.run(query, u_id=user_id)

                for record in result:
                    n = record['n']
                    m = record['m']
                    r = record['r']

                    # สร้าง Node Website (โหนดสีเขียว)
                    if n and n.element_id not in node_ids:
                        nodes.append({
                            "id": n.element_id,
                            "label": n.get("name", "Unknown"),
                            "group": "website"
                        })
                        node_ids.add(n.element_id)

                    # สร้าง Node Tracker (โหนดสีแดง)
                    if m and m.element_id not in node_ids:
                        nodes.append({
                            "id": m.element_id,
                            "label": m.get("name", "Unknown"),
                            "group": "tracker"
                        })
                        node_ids.add(m.element_id)

                    # สร้างเส้นเชื่อม
                    if n and m and r:
                        edges.append({
                            "from": n.element_id,
                            "to": m.element_id,
                            "label": r.get("type", "LINK"),
                            "arrows": "to"
                        })

        return jsonify({"nodes": nodes, "edges": edges})
    except Exception as e:
        print(f"[ERROR] Graph Query Failed: {e}")
        return jsonify({"nodes": [], "edges": []})
    
@app.route('/history', methods=['GET'])
def get_history():
    try:
        site = request.args.get('site')

        conn = mysql.connector.connect(**MYSQL_CONFIG)
        cursor = conn.cursor(dictionary=True)

        if site:
            cursor.execute("""
                SELECT name, domain, label
                FROM cookies
                WHERE domain LIKE %s
                ORDER BY name
            """, (f"%{site}%",))
        else:
            cursor.execute("""
                SELECT name, domain, label
                FROM cookies
                ORDER BY id DESC
                LIMIT 100
            """)

        rows = cursor.fetchall()
        conn.close()

        return jsonify(rows)

    except Exception as e:
        print("[ERROR] History API:", e)
        return jsonify([])

if __name__ == '__main__':
    try:
        print("Starting CookiesChecker Server with Multi-User Support...")
        app.run(host='0.0.0.0', port=5000, threaded=True)
    finally:
        if driver:
            driver.close()
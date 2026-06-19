import os
import psycopg2

def load_env():
    with open('.env') as f:
        for line in f:
            if line.startswith('DATABASE_URL='):
                return line.strip().split('=', 1)[1].strip('"\'')
    return None

def main():
    db_url = load_env()
    if not db_url:
        print("No DATABASE_URL found in .env")
        return
        
    conn = psycopg2.connect(db_url)
    cur = conn.cursor()
    cur.execute("SELECT id, business_id FROM agents")
    agents = cur.fetchall()
    agent_map = {}
    for a in agents:
        if a[1] not in agent_map:
            agent_map[a[1]] = a[0]
            
    prod_count = 0
    for biz, agent in agent_map.items():
        cur.execute("UPDATE commerce_products SET agent_id = %s WHERE business_id = %s AND agent_id IS NULL", (agent, biz))
        prod_count += cur.rowcount
        cur.execute("UPDATE commerce_offers SET agent_id = %s WHERE business_id = %s AND agent_id IS NULL", (agent, biz))
        
    conn.commit()
    print("Successfully updated", prod_count, "products to use default agent_id")

if __name__ == "__main__":
    main()
